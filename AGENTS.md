This projecct "OpenBeacon" is an open source location tracking app with an optional self hosted backend so you can manage your own data.

Users should be able to either host their own backend on their own hardware easily, or pay a simple monthly fee for us to host their own backend.

The core concept of this app is to be privacy focused so if users pay for us to host their own backend we shouldn't be able to know anything they are doing as it should be encrypted by default.

# Technology
Bun will be used in the backend, do not use npm/yarn/pnpm etc
Backend wil be written in NestJS with strict types. The only time a type shouldn't be strictly typed is if given explicit consent by the user.
We should be using zod for input validation
For environment variables in the backend we should be using the @t3-oss/env-core
Database: PostgreSQL with PostGIS for geospatial data using Prisma for a connector
Deployment through Docker containers
All code will be stored in a monorepo using Turborepo
App will be Android only at the moment and written in Kotlin.
Better Auth for authentication

# Project Rules
1. Do not leave comments, code should be understandable by default, if a comment is needed code should ideally be re-written so it's more easily digestable, only time comments should be left is when working around dodgy implementations of other APIs.