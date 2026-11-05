## Architecture

For the most part, when working on one of our NPM packages, all of the code should be placed in the `src/` folder. Usually, at the minimum, the `src/` folder will contain:

- **`app.ts`** - This is the main starting file for the project. This is the file that should house the main logic and any bootstrapping that needs to be done.
- **`cli.ts`** - Entry point for CLI commands. If the project supports CLI commands, then you should handle the logic for the CLI and help menu in this file.
- **`index.ts`** - Entry point to the package for other packages that are including it as a dependency. This is where you would export methods that you want to expose publicly.

We adhere to strict design-patterns across all of our NPM packages. In order for you to get a feel for what we are looking for, you should browse through our [`Buildr`]({{ repository.project.buildr }}) project's files. After browsing through the Buildr project's source code, you will notice that we include other files/folders in the `src/` folder:

- `constants/` - This folder houses all the constant variables used in the project. The constants are generally seperated out into different files based on where they are being used in the application.
- `lib/` - This folder contains all the pieces of the app that would generally be utilized by the `app.ts` file.
- `models/` - This folder contains all of the data models that are used. Data models are important to use especially in larger projects because they provide type definitions and also open the door to data validation which is touched on in the [Preferred Libraries](#preferred-libraries) section.

When building a new project, try to follow the same design patterns that are used by the [`Buildr`]({{ repository.project.buildr }}) project. In most cases, all of the aforementioned files and folders should be part of the project.
