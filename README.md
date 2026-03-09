

# setup
bun i
bun run db:migrate

# run backend
bun run dev --filter=@openbeacon/backend

# run mobile app
cd ./apps/mobile
bun run android