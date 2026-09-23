"""Regression checks for the isolated LOC proposal; uses an in-memory database and no network."""
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4
import grpc
from livepeer_open_clearinghouse.providers.registry_daemon.client import GrpcRegistryClient
from livepeer_open_clearinghouse.errors import DaemonUnavailable, NoRouteAvailable
from livepeer_open_clearinghouse.domains.sessions import runtime
from livepeer_open_clearinghouse.domains.sessions.types import PrepareSessionRequest
from livepeer_open_clearinghouse.domains.payments import service

class PreparationRecovery(unittest.IsolatedAsyncioTestCase):
    async def test_select_many_missing_route_matches_select(self):
        c=GrpcRegistryClient('/unused')
        call=AsyncMock(side_effect=grpc.aio.AioRpcError(grpc.StatusCode.NOT_FOUND,(),(), 'no route'))
        c._ensure_stub=AsyncMock(return_value=SimpleNamespace(SelectMany=call))
        self.assertEqual(await c.select_many('video:transcode.live','gateway-ingest'),[])
        self.assertEqual(call.call_args.kwargs['timeout'],10.0)

    async def test_registry_timeout_is_safe_503(self):
        c=GrpcRegistryClient('/unused')
        c._ensure_stub=AsyncMock(return_value=SimpleNamespace(SelectMany=AsyncMock(side_effect=grpc.aio.AioRpcError(grpc.StatusCode.DEADLINE_EXCEEDED,(),(), 'private upstream detail'))))
        with self.assertRaises(DaemonUnavailable) as caught:
            await c.select_many('video:transcode.live','gateway-ingest')
        self.assertEqual(caught.exception.status_code,503)
        self.assertNotIn('private upstream detail',str(caught.exception))

    async def test_failed_prepare_releases_only_its_pre_payment_claim(self):
        db=SimpleNamespace(rollback=AsyncMock())
        user=SimpleNamespace(id=uuid4()); key=SimpleNamespace(id=uuid4())
        error=NoRouteAvailable(capability='video:transcode.live',offering='gateway-ingest')
        with patch.object(service,'claim_create_request',AsyncMock(return_value=SimpleNamespace(is_replay=False,lease_expires_at=datetime.now(UTC)))), patch.object(runtime.service,'prepare_session',AsyncMock(side_effect=error)), patch.object(service,'release_failed_session_preparation',AsyncMock()) as release, patch.object(service,'complete_create_request',AsyncMock()) as complete:
            with self.assertRaises(NoRouteAvailable):
                await runtime.prepare_session_endpoint(PrepareSessionRequest(capability='video:transcode.live',offering='gateway-ingest',descriptor_schema='rtmp-hls/v1'),(key,user),db,object(),object(),SimpleNamespace(idempotency_inflight_timeout_seconds=300),'same-request:prepare')
            db.rollback.assert_awaited_once(); release.assert_awaited_once();complete.assert_not_awaited()
            self.assertEqual(release.call_args.kwargs['idempotency_key'],'same-request:prepare')

    async def test_release_is_fenced_against_newer_and_completed_claims(self):
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
        from sqlalchemy import select
        from livepeer_open_clearinghouse.providers.db.base import Base
        from livepeer_open_clearinghouse.domains.payments.repo import PaymentIdempotencyKey
        now=datetime.now(UTC); old_expiry=now+timedelta(seconds=300)
        clock=SimpleNamespace(now=lambda:now)
        engine=create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine,expire_on_commit=False)() as db:
            user_id=uuid4()
            row=PaymentIdempotencyKey(user_id=user_id,api_key_id=uuid4(),operation="sessions.prepare",idempotency_key="same",request_fingerprint="unchanged",broker_request_id="unchanged",status="in_flight",expires_at=old_expiry)
            db.add(row);await db.commit()
            async def release(expiry):
                await service.release_failed_session_preparation(db,user_id=user_id,idempotency_key="same",lease_expires_at=expiry,clock=clock)
                await db.refresh(row)
            await release(old_expiry)
            self.assertEqual(row.expires_at.replace(tzinfo=UTC),now)
            self.assertEqual(row.request_fingerprint,"unchanged"); self.assertEqual(row.broker_request_id,"unchanged")
            newer_expiry=now+timedelta(seconds=600);row.expires_at=newer_expiry;await db.commit()
            await release(old_expiry)
            self.assertEqual(row.expires_at.replace(tzinfo=UTC),newer_expiry)
            row.status="completed";await db.commit()
            await release(newer_expiry)
            self.assertEqual(row.expires_at.replace(tzinfo=UTC),newer_expiry)
        await engine.dispose()

if __name__=='__main__': unittest.main()
