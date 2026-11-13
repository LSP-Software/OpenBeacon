# Redis outage verification

Reviewer: server-review agent, independently investigating the parent's failed outage test. Reviewed cache wrapper, Redis options and the integration test. No application code changed.

Verdict: the initial failure is a disposable-container port-mapping artifact. No Redis recovery product finding is supported.

## Evidence

- Parent originally ran the restart test with `REDIS_URL=redis://127.0.0.1:32771`, stopping and restarting `openbeacon-beta2-restart-redis`. That failure is preserved in `tooling/redis-restart.log`.
- After that restart, `docker port openbeacon-beta2-restart-redis` reported `6379/tcp -> 127.0.0.1:32772`. Docker had assigned a different dynamic host port. The existing client was still correctly connecting to the old configured endpoint, which now had no service.
- A fresh Bun RedisClient with an awaited connect returned `Connection closed` for port32771 and `PONG` for port32772. This separates wrong endpoint configuration from a stuck shared client.
- Checked port16379 was free, recreated only the disposable named restart container using its original `docker.dragonflydb.io/dragonflydb/dragonfly:v1.31.2` image with explicit mapping `127.0.0.1:16379:6379`, then ran:

```sh
OPENBEACON_INTEGRATION=1 REDIS_URL=redis://127.0.0.1:16379 REDIS_RESTART_CONTAINER=openbeacon-beta2-restart-redis bun test --isolate packages/cache/src/cache/redisRestart.integration.test.ts
```

- Fixed-port test passed in 36.58 seconds: 1 pass, 0 fail, 8 assertions. Evidence is `tooling/redis-restart-fixed-port.log`. It demonstrates bounded outage behavior, documented fail-open/fail-closed caller results, recovery of the same OpenBeaconCache instance after a 35-second outage, and successful post-recovery consumption.
- `docker port` after the successful restart still reported `127.0.0.1:16379`. Main integration Redis at port32770 was untouched.

## Scope

This verifies the same client's recovery for the exercised 35-second outage against the local Dragonfly image and installed Bun runtime. It does not prove every DNS/address change or network failure mode recovers. The application cannot discover an operator changing Redis's configured host port. No production configuration recommendation follows from this temporary test setup.
