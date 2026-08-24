import type {
  NewPaidOperation,
  PaidOperationClaim,
  PaidOperationProgress,
  PaidOperationRepo,
} from "../engine/repo/index.js";
import type {
  PaidOperation,
  PaidOperationSecrets,
  PaidTerminalEvidence,
} from "../engine/types/index.js";

export interface OwnedPaidSession {
  operation: PaidOperation;
  claim: PaidOperationClaim;
}

export interface PaidSessionStore {
  create(
    value: NewPaidOperation,
    secrets: PaidOperationSecrets,
    now?: Date,
  ): Promise<OwnedPaidSession>;
  claimRecoverable(limit: number, now?: Date): Promise<OwnedPaidSession[]>;
  byLiveStreamId(liveStreamId: string): Promise<PaidOperation | null>;
  byBrokerSessionId(brokerSessionId: string): Promise<PaidOperation | null>;
  readSecrets(value: OwnedPaidSession): Promise<PaidOperationSecrets | null>;
  putSecrets(value: OwnedPaidSession, secrets: PaidOperationSecrets): Promise<boolean>;
  recordProgress(
    value: OwnedPaidSession,
    progress: PaidOperationProgress,
  ): Promise<OwnedPaidSession | null>;
  recordTerminal(
    value: OwnedPaidSession,
    terminal: {
      status: string;
      claimedUnits: string;
      settlementSequence: string;
      evidence: PaidTerminalEvidence;
      terminalAt: Date;
    },
  ): Promise<boolean>;
  renew(value: OwnedPaidSession, now?: Date): Promise<OwnedPaidSession | null>;
  release(value: OwnedPaidSession): Promise<boolean>;
}

export interface PaidSessionStoreOptions {
  repo: PaidOperationRepo;
  owner: string;
  leaseDurationMs: number;
  now?: () => Date;
}

function claimFor(
  operation: PaidOperation,
  expectedOwner: string,
): PaidOperationClaim {
  if (
    operation.kind !== "session" ||
    !operation.liveStreamId ||
    !operation.sessionRuntime ||
    operation.recoveryOwner !== expectedOwner ||
    !operation.recoveryLeaseExpiresAt
  ) {
    throw new Error("paid session is missing durable recovery state");
  }
  return {
    owner: operation.recoveryOwner,
    version: operation.lifecycleVersion,
    leaseExpiresAt: operation.recoveryLeaseExpiresAt,
  };
}

function owned(
  operation: PaidOperation,
  expectedOwner: string,
): OwnedPaidSession {
  return { operation, claim: claimFor(operation, expectedOwner) };
}

export function createPaidSessionStore(
  options: PaidSessionStoreOptions,
): PaidSessionStore {
  if (
    options.owner.length === 0 ||
    options.owner.length > 255 ||
    !Number.isSafeInteger(options.leaseDurationMs) ||
    options.leaseDurationMs < 1_000
  ) {
    throw new Error("paid session store options are invalid");
  }
  const clock = options.now ?? (() => new Date());
  const leaseAfter = (now: Date): Date =>
    new Date(now.getTime() + options.leaseDurationMs);

  return {
    async create(value, secrets, now = clock()) {
      if (
        value.kind !== "session" ||
        !value.liveStreamId ||
        !value.sessionRuntime
      ) {
        throw new Error("paid session create requires live recovery state");
      }
      return owned(
        await options.repo.insertWithSecrets(value, secrets, {
          owner: options.owner,
          leaseExpiresAt: leaseAfter(now),
        }),
        options.owner,
      );
    },

    async claimRecoverable(limit, now = clock()) {
      const operations = await options.repo.claimRecoverable(
        "session",
        options.owner,
        now,
        leaseAfter(now),
        limit,
      );
      return operations.map((operation) => owned(operation, options.owner));
    },

    byLiveStreamId(liveStreamId) {
      return options.repo.byLiveStreamId(liveStreamId);
    },

    byBrokerSessionId(brokerSessionId) {
      return options.repo.byBrokerSessionId(brokerSessionId);
    },

    readSecrets(value) {
      return options.repo.readSecrets(value.operation.id, value.claim);
    },

    putSecrets(value, secrets) {
      return options.repo.putSecrets(value.operation.id, value.claim, secrets);
    },

    async recordProgress(value, progress) {
      const operation = await options.repo.recordProgress(
        value.operation.id,
        value.claim,
        progress,
      );
      return operation ? owned(operation, options.owner) : null;
    },

    recordTerminal(value, terminal) {
      return options.repo.recordTerminal(
        value.operation.id,
        value.claim,
        terminal,
      );
    },

    async renew(value, now = clock()) {
      const operation = await options.repo.renewClaim(
        value.operation.id,
        value.claim,
        leaseAfter(now),
      );
      return operation ? owned(operation, options.owner) : null;
    },

    release(value) {
      return options.repo.releaseClaim(value.operation.id, value.claim);
    },
  };
}
