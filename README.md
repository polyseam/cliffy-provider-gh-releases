# cliffy-provider-github-releases

This is a provider for [cliffy](https://cliffy.io) which enables the updating of
a CLI tool via GitHub releases.

## usage

_for a complete example, see the [demo](./demo) directory_

The following snippet instantiates an `UpgradeCommand`, it is configured by
passing an instance of `GithubReleaseProvider` to it.

The `GithubReleaseProvider` takes:

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
  GithubReleaseProvider,
  GithubReleasesUpgradeCommand,
} from "jsr:@polyseam/cliffy-provider-github-releases";

// This UpgradeCommand can be used in place of the default Cliffy UpgradeCommand
const upgradeCommand = new GithubReleaseUpgradeCommand({
  provider: new GithubReleaseProvider({
    repository: "polyseam/cndi",
    destinationDir: "~/.cndi/bin",
    osAssetMap: {
      windows: "cndi-win.tar.gz",
      linux: "cndi-linux.tar.gz",
      darwin: "cndi-mac.tar.gz",
    },
    onError: (error: GHRError) => {
      const exit_code = parseInt(`8${error.code}`);
      Deno.exit(exit_code);
    },
    onComplete: (_version) => {
      Deno.exit(0);
    },
  }),
});
```
