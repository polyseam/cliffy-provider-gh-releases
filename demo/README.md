# @cliffy-provider-gh-releases/demo

A small sandbox to demonstrate the usage of the
[cliffy-provider-gh-releases](../) module.

## usage

1. Create a repo on GitHub with a Release
2. update [./demo.ts](./demo.ts) to point to it
3. If you are using a private repo, set the `GITHUB_TOKEN` environment variable
   to a
   [personal access token](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token)
   with the `repo` scope

Then you can run the demo application with the following command:

```sh
deno task run upgrade --version v1.0.0
```
