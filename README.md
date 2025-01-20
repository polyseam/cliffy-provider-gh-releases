# cliffy-provider-github-releases

This is a provider for [cliffy](https://cliffy.io) which enables the updating of
a CLI tool via
[GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github).

## usage

_for a complete example, see the
[polyseam/cliffy-ghr-demo](https://github.com/polyseam/cliffy-ghr-demo) repo_

The following snippet instantiates an `GithubReleasesUpgradeCommand`, it is
configured by passing an instance of `GithubReleasesProvider` to it.

The `GithubReleasesProvider` takes:

- `repository` a string in the format `owner/repo` which points to the
  repository to fetch releases from.
- `osAssetMap` a map of `Deno.build.os` entries to corresponding asset tarballs
- `destinationDir` a string which points to the directory where the tarball
  contents should be extracted to

and optionally, for more fine-grained control over how error and success events
are handled:

- `onError` a function which is called when an error occurs, it is passed an
  instance of `GHRError`
- `onComplete` a function which is called when the upgrade process completes, it
  is passed the version string of the release that was installed

```typescript
import {
  GHRError,
  GithubReleasesProvider,
  GithubReleasesUpgradeCommand,
} from "jsr:@polyseam/cliffy-provider-github-releases";

// This UpgradeCommand can be used in place of the default Cliffy UpgradeCommand
const upgradeCommand = new GithubReleasesUpgradeCommand({
  provider: new GithubReleasesProvider({
    repository: "polyseam/cndi",
    destinationDir: "~/.cndi/bin",
    targetAssetMap: {
      `windows-x86_64`: "cndi-win-amd64.tar.gz",
      `linux-x86_64`: "cndi-linux-amd64.tar.gz",
      `linux-aarch64`: "cndi-linux-arm64.tar.gz",
      `darwin-x86_64`: "cndi-mac-amd64.tar.gz",
      `darwin-aarch64`: "cndi-mac-arm64.tar.gz",
    },
    onError: (error: GHRError) => {
      const exit_code = parseInt(`8${error.code}`);
      Deno.exit(exit_code);
    },
    onComplete: (_info) => {
      Deno.exit(0);
    },
  }),
});
```
