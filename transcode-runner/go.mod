module github.com/Cloud-SPE/livepeer-modules-transcode/transcode-runner

go 1.25

require github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core v0.0.0

require gopkg.in/yaml.v3 v3.0.1 // indirect

replace github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core => ../transcode-core
