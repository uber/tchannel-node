yab -p 127.0.0.1:4040 server get_obj --timeout=500 -d 8s --concurrency=50 --connections=8

```
Benchmark parameters:
  CPUs:            4
  Connections:     8
  Concurrency:     50
  Max requests:    1000000
  Max duration:    8s
  Max RPS:         0
Latencies:
  0.5000: 203.995733ms
  0.9000: 212.827071ms
  0.9500: 216.465045ms
  0.9900: 242.144861ms
  0.9990: 272.611947ms
  0.9995: 275.147078ms
  1.0000: 275.618402ms
Elapsed time:      8.195s
Total requests:    15733
RPS:               1919.80
```

yab -p 127.0.0.1:4040 server get_obj --timeout=500 -d 8s --concurrency=100 --connections=8

```
Benchmark parameters:
  CPUs:            4
  Connections:     8
  Concurrency:     100
  Max requests:    1000000
  Max duration:    8s
  Max RPS:         0
Latencies:
  0.5000: 226.33612ms
  0.9000: 258.354269ms
  0.9500: 276.533397ms
  0.9900: 328.436785ms
  0.9990: 363.666322ms
  0.9995: 376.618183ms
  1.0000: 396.013348ms
Elapsed time:      8.215s
Total requests:    27970
RPS:               3404.71
```

yab -p 127.0.0.1:4040 server get_obj --timeout=500 -d 8s --concurrency=250 --connections=8

```
Benchmark parameters:
  CPUs:            4
  Connections:     8
  Concurrency:     250
  Max requests:    1000000
  Max duration:    8s
  Max RPS:         0
Errors:
     9: tchannel error ErrCodeTimeout: request timed out after XXXms (limit was XXXms)
  15386: tchannel error ErrCodeTimeout: timeout
Total errors: 15395
Latencies:
  0.5000: 438.463855ms
  0.9000: 493.410255ms
  0.9500: 497.18692ms
  0.9900: 521.067478ms
  0.9990: 719.454767ms
  0.9995: 733.095378ms
  1.0000: 735.646029ms
Elapsed time:      8.398s
Total requests:    20727
RPS:               2468.05
```

yab -p 127.0.0.1:4040 server get_obj --timeout=500 -d 8s --concurrency=500 --connections=8

```
Benchmark parameters:
  CPUs:            4
  Connections:     8
  Concurrency:     500
  Max requests:    1000000
  Max duration:    8s
  Max RPS:         0
Errors:
  58961: tchannel error ErrCodeTimeout: timeout
Total errors: 58961
Latencies:
  0.5000: 467.063553ms
  0.9000: 490.890266ms
  0.9500: 495.091347ms
  0.9900: 508.876273ms
  0.9990: 524.108808ms
  0.9995: 545.232108ms
  1.0000: 615.105973ms
Elapsed time:      8.53s
Total requests:    1643
RPS:               192.61
```
