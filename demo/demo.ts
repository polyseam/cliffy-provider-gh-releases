import { join } from "@std/path";
import {
  GHRError,
  GithubReleasesProvider,
  GithubReleasesUpgradeCommand,
} from "@polyseam/cliffy-provider-gh-releases";
import { colors } from "@cliffy/ansi";
import { Command } from "@cliffy/command";

// Deno.cwd() is the parent directory of the demo directory
const destinationDir = join(Deno.cwd(), "demo", "demo-dist", "bin");

function printError(error: GHRError) {
  console.log("\n");
  console.error("error:", colors.brightRed(error.message));

  if (error.metadata) {
    for (const key in error.metadata) {
      console.error(`${key}:`, colors.brightRed(`${error.metadata[key]!}`));
    }
  }
  console.log("\n");
}

const upgradeCommand = new GithubReleasesUpgradeCommand({
  provider: new GithubReleasesProvider({
    repository: "polyseam/cndi",
    destinationDir,
    osAssetMap: {
      windows: "cndi-win.tar.gz",
      linux: "cndi-linux.tar.gz",
      darwin: "cndi-mac.tar.gz",
    },
    onError: (error: GHRError) => {
      printError(error);
      const exit_code = parseInt(`8${error.code}`);
      Deno.exit(exit_code);
    },
    onComplete: () => {
      console.log("\ninstalled!");
      Deno.exit(0);
    },
  }),
});

const cli = new Command()
  .name("demo")
  .version("0.1.0")
  .command(
    "hello",
    new Command().action(() => console.log("Hello World!"))
  )
  .command("upgrade", upgradeCommand);

if (import.meta.main) {
  await cli.parse(Deno.args);
}
