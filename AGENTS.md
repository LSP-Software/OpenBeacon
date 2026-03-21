This project "OpenBeacon" is an open source, privacy-first family location tracking app with an optional self-hosted backend so users can manage their own data.

Users should be able to either host their own backend on their own hardware easily, or pay a simple monthly fee to use our hosted API.

The core concept of this app is to be privacy focused so if users pay for us to host their own backend we shouldn't be able to know anything they are doing as it should be encrypted by default.

# Project Rules
1. Do not leave comments; code should be understandable by default. Only leave comments when working around dodgy implementations of other APIs.
2. When installing new packages always install the latest with the bun `install command`; don't guess the version number.
3. Before committing, run `bun install --frozen-lockfile`; if it fails due to lockfile changes, run `bun install`, commit `bun.lock`, then re-run the frozen install.
4. After making changes, always run the ci script (`bun run ci`) to ensure your changes haven't broken anything.
5. We need strong types to ensure high quality code so AI tools don't introduce errors, anything added must use strict types, try to reuse types where possible but if not introduce types.
6. When making database changes make sure to create a migration with the db:generate script in the database package.
7. Mobile UI must be built from React Native core components; do not introduce UI frameworks/component libraries.
8. All TypeScript import paths must end with `.ts`, not `.js`.
9. Try to use our custom try catch function instead of the standard try catch implementation. When awaiting many calls in one go this can get lengthy so feel free to use the old try catch to keep it simple.
  ```ts
    // WRONG
    try {
      const result = await addTwoNumbers(1, 2);
      console.log(result)
    } catch (e) {
      console.log('ERROR');
    }

    //Correct
    const result = await tryCatch(addTwoNumbers(1, 2));
    if (result.error) {
      console.log('ERROR');
      return
    }
    console.log(result.data)
  ```
10. Always use const name = () => {} over function name () {}
11. When using types we should be careful about how we define them.
  a. If a type is only used in one place (say a return) we should just hard code it as the return value, don't define it as it's own type.
  b. If a type is used in multiple places in the same file, define the type as it's own separate thing inside of that file.
  c. If a type is used across multiple files, define it in it's own type file. Feel free to put a type in an existing type file if it matches the theme.

# Testing
When logic is added we should add tests around it to ensure high quality code. Test should be thoughtful and well considered and not just be added to test everything. We don't need to test that a button works, however logic around encryption etc should be tested to ensure we cannot break it.

# Code Styling
Code should be written as simply as possible to help with readability in the future. Functions should only be split into separate functions when either the original function becomes extremely long, or when logic inside of that function is reused. Things such as constants shouldn't be extracted unless they're re-used, same with types etc.