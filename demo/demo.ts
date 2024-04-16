import { join } from "jsr:@std/path@0.222.1";
import { colors } from "jsr:@cliffy/ansi@1.0.0-rc.4";
import { Command } from "jsr:@cliffy/command@1.0.0-rc.4";
import {
  type GHRError,
  GithubReleasesProvider,
  GithubReleasesUpgradeCommand,
} from "../mod.ts";

const destinationDir = join(Deno.cwd(), "dist");

function printError(error: GHRError) {
  console.log("\n");
  console.error("error:", colors.brightRed(error.message));
  console.error("code:", colors.brightRed(`${error.code}`));

  if (error.metadata) {
    for (const key in error.metadata) {
      console.error(`${key}:`, colors.brightRed(`${error.metadata[key]!}`));
    }
  }
  console.log("\n");
}

const upgradeCommand = new GithubReleasesUpgradeCommand({
  provider: new GithubReleasesProvider({
    repository: "polyseam/cliffy-provider-github-releases",
    destinationDir,
    osAssetMap: {
      darwin: "demo-mac.tar.gz",
      linux: "demo-linux.tar.gz",
      windows: "demo-windows.tar.gz",
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
