This project "OpenBeacon" is an open source location tracking app with an optional self hosted backend so you can manage your own data.

Users should be able to either host their own backend on their own hardware easily, or pay a simple monthly fee for us to host their own backend.

The core concept of this app is to be privacy focused so if users pay for us to host their own backend we shouldn't be able to know anything they are doing as it should be encrypted by default.

# Technology
- Bun will be used in the backend, do not use npm/yarn/pnpm etc
- Backend wil be written in NestJS with strict types. The only time a type shouldn't be strictly typed is if given explicit consent by the user.
- We should be using zod for input validation
- For environment variables in the backend we should be using the @t3-oss/env-core
- Database: PostgreSQL with PostGIS for geospatial data using Drizzle for a connector
- Deployment through Docker containers
- All code will be stored in a monorepo using Turborepo
- App will be Android only at the moment and written in Kotlin.
- Better Auth for authentication
- Biome for linting/formatting with all TS apps

# Project Rules
1. Do not leave comments, code should be understandable by default, if a comment is needed code should ideally be re-written so it's more easily digestible, only time comments should be left is when working around dodgy implementations of other APIs.
2. When installing new packages always install the latest with the bun install command, don't guess the version number.
3. We need to add strong tools/rules to ensure that we are writing high quality code so that AI tools don't introduce errors, make sure with anything you're adding we have strict type checking rules.
4. After making changes, always run the ci script (`bun run ci`) to ensure your changes haven't broken anything.
5. When making database changes make sure to create a migration with the db:generate script in the database package.

# Project Structure
/apps # All deployed applications
  /backend # NestJS backend
  /android # Android App (not implemented yet)
  /ios # IOS app (not implemented yet)
  /site # Web app (not implemented yet)
/packages # All shared code
  /database # Drizzle Database ORM
  /tsconfig # tsconfig shared logic