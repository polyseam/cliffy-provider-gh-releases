import { join } from "jsr:@std/path@0.222.1";
import { colors } from "jsr:@cliffy/ansi@1.0.0-rc.4";
import { Command } from "jsr:@cliffy/command@1.0.0-rc.4";
import {
  GHRError,
  GithubReleasesProvider,
  GithubReleasesUpgradeCommand,
} from "../mod.ts";

const destinationDir = join(Deno.cwd(), "dist");

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
    repository: "polyseam/private-release",
    destinationDir,
    osAssetMap: {
      darwin: "hello-worlds-mac.tar.gz",
      linux: "hello-worlds-linux.tar.gz",
      windows: "hello-worlds-windows.zip",
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
    new Command().action(() => console.log("Hello World!")),
  )
  .command("upgrade", upgradeCommand);

if (import.meta.main) {
  await cli.parse(Deno.args);
}
