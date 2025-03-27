import {
  colors,
  ensureDirSync,
  homedir,
  inflateResponse,
  Octokit,
  Provider,
  semver,
  Spinner,
  UpgradeCommand,
  walkSync,
} from "./deps.ts";

import type { OctokitEndpoints } from "./deps.ts";

import type { GithubProviderOptions, ProviderUpgradeOptions } from "./deps.ts";

const OLD_VERSION_TAG = ".GHR_OLD.";

type CompilationTargetAssetMap = {
  "darwin-x86_64": string;
  "darwin-aarch64": string;
  "linux-x86_64": string;
  "linux-aarch64": string;
  "windows-x86_64": string;
  // 'windows-aaarch64': string; theoretically possible, but not supported by deno compile
};

type ReleaseResponse =
  OctokitEndpoints["GET /repos/{owner}/{repo}/releases/tags/{tag}"]["response"];
type ReleaseParameters =
  OctokitEndpoints["GET /repos/{owner}/{repo}/releases/tags/{tag}"][
    "parameters"
  ];
type AssetParameters =
  OctokitEndpoints["GET /repos/{owner}/{repo}/releases/assets/{asset_id}"][
    "parameters"
  ];

/**
 * ERROR_CODE_MAP
 * A map of error codes to human-readable error messages
 ***/
export const ERROR_CODE_MAP = {
  1: "repository must be in the format 'owner/repo'", // Provider options configured incorrectly
  2: "Found old version but failed to delete", // old version found but failed to delete
  3: "No asset name found for the current OS", // asset name not found in osAssetMap
  4: "No asset found for the current OS", // asset not found in release
  5: "Network Error: failed to fetch GitHub Release Asset Data", // fetch() failed
  // 5xxx errors are for fetch() errors
  5404: "Failed to fetch GitHub Release Asset Data - Not Found",
  5500: "Failed to fetch GitHub Release Asset - Internal Server Error",
  // 6xxx errors are for octokit.request(data) errors
  6404: "Failed to octokit.request GitHub Release Asset Data - Not Found",
  6500:
    "Failed to octokit.request GitHub Release Asset Data - Internal Server Error",
  // 7xxx errors are for octokit.request(release list) errors
  7404: "Failed to octokit.request Release List from GitHub - Not Found",
  7500:
    "Failed to octokit.request Release List from GitHub - Internal Server Error",
  8: "Failed to extract archive", // inflateResponse failed
  9: "Failed to stash old version", // rename running bin failed
  10: "Failed to install new version", // write new bin failed
};

/**
 * GHRError
 * A simple Error object which includes a code and optional metadata
 * @param message - A human-readable error message
 * @param code - A numeric error code
 * @param metadata - An optional object containing additional error information
 */

export type GHRErrorOptions = {
  code: number;
  metadata: Record<string, unknown>;
};

export class GHRError extends Error {
  code: number;
  metadata: Record<string, unknown>;
  constructor(message: string, options: GHRErrorOptions) {
    super(message);
    const { code, metadata } = options;
    this.code = parseInt(`${this.errorCodePrefix}${code}`);
    this.metadata = metadata;
  }
}

// this is the trick to make GHRError.prototype.errorCodePrefix "type safe"
export interface GHRError {
  errorCodePrefix: string;
}

type OnCompleteMetadata = {
  to: string;
  from?: string;
};

type OnCompleteFinalCallback = () => void;

interface GithubReleasesProviderUpgradeOptions extends ProviderUpgradeOptions {
}

interface GithubReleasesProviderOptions extends GithubProviderOptions {
  destinationDir: string;
  displaySpinner?: boolean;
  prerelease?: boolean;
  untar?: boolean;
  cleanupOld?: boolean;
  targetAssetMap: CompilationTargetAssetMap;
  skipAuth?: boolean;
  errorExitCodePrefix?: string; // all upgrade errors can use the same common prefix for bad exits
  repository: string;
  onComplete?: (
    metadata: OnCompleteMetadata,
    cb: OnCompleteFinalCallback,
  ) => void | never;
  onError: (error: GHRError) => Promise<never>;
}

type GithubReleaseVersions = {
  versions: string[];
  latest: string;
};

function latestSemVerFirst(a: string, b: string): number {
  const aParsed = semver.tryParse(a);
  const bParsed = semver.tryParse(b);
  if (aParsed && bParsed) {
    // compare a and b in descending order
    return semver.compare(bParsed, aParsed);
  } else {
    return 0; // SemVer parsing failed in atleast one value, preserve order
  }
}

/**
 * GithubReleasesProvider
 * A Cliffy UpgradeProvider for GitHub Releases
 * @param options - An object containing the following properties:
 * - repository: A string in the format 'owner/repo'
 * - destinationDir: A string representing the directory where the release will be installed
 * - targetAssetMap: An object mapping compilation targets to corresponding assets in GitHub Releases
 * - skipAuth: An optional boolean to skip authentication (not recommended)
 * - onError: An optional callback function to handle errors
 * - onComplete: An optional callback function to handle completion
 */
export class GithubReleasesProvider extends Provider {
  name: string = "GithubReleaseProvider";
  displaySpinner: boolean = true;
  prerelease: boolean = false;
  destinationDir: string;
  octokit: Octokit;
  owner: string;
  repo: string;
  targetAssetMap: CompilationTargetAssetMap;
  cleanupOld: boolean = true;
  skipAuth: boolean = false;

  onComplete: (
    metadata: OnCompleteMetadata,
    cb: OnCompleteFinalCallback,
  ) => void;

  onError: (error: GHRError) => Promise<never>;

  constructor(options: GithubReleasesProviderOptions) {
    super();

    // set the error code prefix once at the class level
    GHRError.prototype.errorCodePrefix = options.errorExitCodePrefix || "";

    this.onComplete = options?.onComplete ||
      ((_meta: OnCompleteMetadata, _cb: OnCompleteFinalCallback) => {});

    this.onError = options?.onError || ((e: GHRError) => {
      Deno.exit(e.code);
    });

    const [owner, repo] = options.repository.split("/");

    if (!owner || !repo) {
      const error = new GHRError(
        "repository must be in the format 'owner/repo'",
        {
          code: 1,
          metadata: {
            repository: options.repository,
          },
        },
      );

      this.onError(error);

      // required because onError() is async and async functions can't be called in the constructor
      Deno?.exit(error.code);
    }

    this.owner = owner;
    this.repo = repo;
    this.destinationDir = options.destinationDir.replace("~", homedir());

    ensureDirSync(this.destinationDir);
    this.targetAssetMap = options.targetAssetMap;

    if (options.displaySpinner === false) {
      this.displaySpinner = false;
    }

    if (options.prerelease === true) {
      this.prerelease = true;
    }

    this.skipAuth = !!options.skipAuth;

    const auth = this.skipAuth
      ? undefined
      : Deno.env.get("GITHUB_TOKEN") ?? Deno.env.get("GH_TOKEN");

    this.octokit = new Octokit({ auth });

    if (options.cleanupOld === false) {
      this.cleanupOld = false;
    }

    if (this.cleanupOld) {
      // triggering this in the provider constructor is somewhat gross
      // however it's the only way to ensure that the cleanup happens
      this.cleanOldVersions();
      // the fact that it is async but called without await in the constructor is a bit sketchy
    }
  }

  async cleanOldVersions() {
    for (const entry of walkSync(this.destinationDir)) {
      if (entry.path.includes(OLD_VERSION_TAG)) {
        try {
          Deno.removeSync(entry.path);
        } catch (caught) {
          if (!(caught instanceof Deno.errors.NotFound)) {
            const foundButFailedToDelete = new GHRError(
              "Found old version but failed to delete",
              {
                metadata: {
                  oldfile: entry.path,
                  caught,
                },
                code: 2,
              },
            );
            await this.onError(foundButFailedToDelete);
            throw foundButFailedToDelete;
          }
        }
      }
    }
  }

  getAssetName(): string | null {
    const os = Deno.build.os;
    const arch = Deno.build.arch;
    const key = `${os}-${arch}`;
    const assetName = this.targetAssetMap
      ?.[key as keyof CompilationTargetAssetMap];

    if (!assetName) {
      return null;
    }

    return assetName;
  }

  getRepositoryUrl(_name: string): string {
    return `https://github.com/${this.owner}/${this.repo}/releases`;
  }

  getRegistryUrl(_name: string, version: string): string {
    return `https://github.com/${this.owner}/${this.repo}/releases/tag/${version}`;
  }

  getReleaseOctokitRequest(version: string): {
    path: string;
    opt: ReleaseParameters;
  } {
    return {
      path: `GET /repos/{owner}/{repo}/releases/tags/{tag}`,
      opt: {
        owner: this.owner,
        repo: this.repo,
        tag: version,
      },
    };
  }

  async getOctokitAssetRequest(releaseResponse: ReleaseResponse): Promise<{
    path: string;
    opt: AssetParameters;
  }> {
    const assetName = this.getAssetName();

    if (!assetName) {
      const error = new GHRError(
        "Failed to find asset name for current OS",
        {
          code: 3,
          metadata: {
            os: Deno.build.os,
            arch: Deno.build.arch,
            targetAssetMap: this.targetAssetMap,
          },
        },
      );
      await this.onError(error);
      throw error;
    }

    const asset = releaseResponse.data.assets.find(
      (asset: { name: string }) => asset.name === assetName,
    );
    if (!asset) {
      const e = new GHRError("Failed to find asset for current OS", {
        code: 4,
        metadata: {
          os: Deno.build.os,
          assetName,
          assets: releaseResponse.data.assets,
        },
      });
      await this.onError(e);
      throw e;
    }
    const assetId = asset.id;

    // this url could be used with fetch() instead of octokit
    const _assetUrl =
      `https://api.github.com/repos/${this.owner}/${this.repo}/releases/assets/${assetId}`;

    return {
      path: `GET /repos/{owner}/{repo}/releases/assets/{asset_id}`,
      opt: { owner: this.owner, repo: this.repo, asset_id: assetId },
    };
  }

  // Add your custom code here
  //@ts-ignore - hotfix!
  async upgrade(options: GithubReleasesProviderUpgradeOptions): Promise<void> {
    let { name, from, to } = options;
    const { os, arch } = Deno.build;
    const spinner = new Spinner({
      message: `Upgrading ${colors.cyan(name)} from ${
        colors.yellow(
          from || "?",
        )
      } to version ${colors.cyan(to)}...`,
      color: "cyan",
      spinner: [
        "▰▱▱▱▱▱▱",
        "▰▰▱▱▱▱▱",
        "▰▰▰▱▱▱▱",
        "▰▰▰▰▱▱▱",
        "▰▰▰▰▰▱▱",
        "▰▰▰▰▰▰▱",
        "▰▰▰▰▰▰▰",
        "▰▱▱▱▱▱▱",
      ],
      interval: 80,
    });

    if (this.displaySpinner) {
      spinner.start();
    }

    const versions = await this.getVersions(name);

    if (to === "latest") {
      to = versions.latest;
    }

    let response; // Wraps the Asset Data for inflate_response
    const stagingDir = Deno.makeTempDirSync();
    let errorDetail = {};

    if (this.skipAuth) {
      try {
        const assetName = this.getAssetName();
        if (!assetName) {
          const error = new GHRError(
            "Failed to find asset name for current OS",
            {
              code: 3,
              metadata: {
                os,
                arch,
                targetAssetMap: this.targetAssetMap,
              },
            },
          );
          this.onError(error);
          throw error;
        }
        const url =
          `https://github.com/${this.owner}/${this.repo}/releases/download/${to}/${assetName}`;
        response = await fetch(url);
        errorDetail = {
          url,
        };
        if (response.status !== 200) {
          const error = new GHRError(
            "Failed to fetch GitHub Release Asset",
            {
              code: parseInt(`5${response.status}`),
              metadata: {
                ...errorDetail,
                status: response.status,
              },
            },
          );
          await this.onError(error);
          throw error;
        }
      } catch (caught) {
        const error = new GHRError(
          "Network Error: Failed to fetch GitHub Release Asset",
          {
            code: 5,
            metadata: {
              ...errorDetail,
              caught,
            },
          },
        );
        await this.onError(error);
        throw error;
      }
    } else {
      const req = this.getReleaseOctokitRequest(to);

      let releaseResponse; // Release Metadata
      try {
        releaseResponse = await this.octokit.request(req.path, req.opt);
      } catch (octokitError) {
        const caught = octokitError as { status: number };
        const error = new GHRError(
          "Failed to fetch Release metadata",
          // @ts-ignore - hotfix!
          {
            code: parseInt(`5${caught.status || ""}`),
            metadata: {
              ...req,
              caught: octokitError,
            },
          },
        );
        await this.onError(error);
        throw error;
      }

      const { path: assetReqPath, opt: assetReqOpt } = await this
        .getOctokitAssetRequest(
          releaseResponse as ReleaseResponse, // if (releaseResponse.status === 200), this is safe
        );

      let octokitAssetResponse; // Asset Data

      errorDetail = {
        assetReqPath,
        assetReqOpt,
      };

      try {
        octokitAssetResponse = await this.octokit.request(assetReqPath, {
          ...assetReqOpt,
          headers: {
            Accept: "application/octet-stream",
          },
          request: {
            responseType: "arraybuffer",
          },
        });

        // how costly is creating a Response?
        response = new Response(octokitAssetResponse.data, {
          status: octokitAssetResponse.status,
        });
      } catch (octokitError) {
        const caught = octokitError as { status: number };
        const error = new GHRError(
          "Failed to fetch GitHub Release Asset Data",
          {
            code: parseInt(`6${caught.status}`),
            metadata: {
              ...errorDetail,
              caught,
            },
          },
        );
        await this.onError(error);
        throw error;
      }
    }

    try {
      await inflateResponse(response, stagingDir, {
        compressionFormat: "gzip",
        doUntar: true,
      });
    } catch (caught) {
      const assetName = this.getAssetName();

      if (!assetName) {
        const error = new GHRError(
          `Failed to find asset for compilation target`,
          {
            code: 3,
            metadata: {
              os,
              arch,
              targetAssetMap: this.targetAssetMap,
            },
          },
        );
        await this.onError(error);
        throw error;
      }

      const error = new GHRError(
        `Failed to extract '${assetName}' archive`,
        {
          metadata: { caught },
          code: 8,
        },
      );

      await this.onError(error);
      throw error;
    }

    for (const entry of walkSync(stagingDir)) {
      if (entry.isFile) {
        const finalPath = entry.path.replace(stagingDir, this.destinationDir);

        try {
          // stash the old version
          Deno.renameSync(finalPath, `${finalPath}${OLD_VERSION_TAG}`);
        } catch (caught) {
          if (!(caught instanceof Deno.errors.NotFound)) {
            const error = new GHRError("Failed to stash old version", {
              code: 9,
              metadata: {
                caught,
                oldfile: finalPath,
              },
            });
            await this.onError(error);
            throw error;
          }
        }

        // install the new version
        try {
          Deno.renameSync(entry.path, finalPath);
        } catch (caught) {
          const error = new GHRError("Failed to install new version", {
            code: 10,
            metadata: {
              caught,
              newfile: entry.path,
            },
          });
          await this.onError(error);
          throw error;
        }
        if (os !== "windows") {
          Deno.chmodSync(finalPath, 0o755);
        }
      }
    }

    this.onComplete({ to, from }, function printSuccessMessage() {
      spinner.stop();
      const fromMsg = from ? ` from version ${colors.yellow(from)}` : "";
      console.log(
        `Successfully upgraded ${
          colors.cyan(
            name,
          )
        }${fromMsg} to version ${colors.green(to)}!\n`,
      );
    });
  }

  async getVersions(_name: string): Promise<GithubReleaseVersions> {
    const url =
      `https://api.github.com/repos/${this.owner}/${this.repo}/releases`;
    let listReleasesResponse;
    try {
      listReleasesResponse = await this.octokit.request(
        "GET /repos/{owner}/{repo}/releases",
        {
          owner: this.owner,
          repo: this.repo,
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
    } catch (error) {
      //@ts-ignore - hotfix!
      const status = error.status;
      const getVersionsError = new GHRError(
        "Failed to octokit.request Release List from GitHub.",
        {
          code: parseInt(`7${status}`),
          metadata: {
            status,
            caught: error,
            url,
          },
        },
      );
      await this.onError(getVersionsError);
      throw getVersionsError;
    }

    const versions = listReleasesResponse.data
      .filter((release: { draft: boolean; prerelease: boolean }) => {
        // never include draft releases
        if (release.draft) return false;
        // only include prereleases if the prerelease option is set to true
        if (release.prerelease) {
          if (this.prerelease) return true;
          // otherwise include all non-prerelease releases
          return false;
        }
        return true;
      })
      .map(({ tag_name }: { tag_name: string }) => tag_name)
      .sort(latestSemVerFirst);

    const latest = versions[0];

    return {
      versions, // branches and tags
      latest,
    };
  }

  //@ts-ignore hotfix!
  async listVersions(
    name: string,
    currentVersion?: string | undefined,
  ): Promise<void> {
    const { versions } = await this.getVersions(name);
    super.printVersions(versions, currentVersion, { indent: 0 });
  }
}

interface GithubReleasesUpgradeOptions {
  provider: GithubReleasesProvider;
}

interface UpgradeActionOptions {
  force: boolean;
  verbose: boolean;
  version: string;
  to: string;
  from?: string;
}

const mutedLogger = {
  info: () => {},
  error: () => {},
  log: () => {},
  warn: () => {},
};

/**
 * GithubReleasesUpgradeCommand
 * A Cliffy UpgradeCommand for upgrading software using GitHub Releases
 * @param options - An object containing the following properties:
 * - provider: A GithubReleasesProvider instance
 */
export class GithubReleasesUpgradeCommand extends UpgradeCommand {
  constructor(options: GithubReleasesUpgradeOptions) {
    const opt = { ...options, logger: mutedLogger };
    super(opt);

    // assumes only one provider is passed into command constructor
    const provider: GithubReleasesProvider = Array.isArray(options.provider)
      ? options.provider[0]
      : options.provider;

    this.option(
      "--pre-release, --prerelease",
      "Include GitHub Releases marked pre-release",
      () => {
        if (provider instanceof GithubReleasesProvider) {
          provider.prerelease = true;
        }
      },
    );
  }
}
