// cliffy
export { Provider, UpgradeCommand } from "@cliffy/command/upgrade";
export type { GithubProviderOptions } from "@cliffy/command/upgrade/provider/github";
export type { UpgradeCommandOptions } from "@cliffy/command/upgrade";
export { colors } from "@cliffy/ansi/colors";
export interface ProviderUpgradeOptions {
  name: string;
  to: string;
  main?: string;
  args?: Array<string>;
  from?: string;
  force?: boolean;
  verbose?: boolean;
}
// node builtins
export { homedir } from "node:os";

// std
export { Spinner } from "@std/cli/spinner";
export { type SpinnerOptions } from "@std/cli/spinner";
import { compare, tryParse } from "@std/semver";
export const semver = {
  compare,
  tryParse,
};
export { ensureDirSync, walkSync } from "@std/fs";

// github
export { Octokit } from "octokit";
export type { Endpoints as OctokitEndpoints } from "@octokit/types";

// homegrown
export { inflateResponse } from "@polyseam/inflate-response";
