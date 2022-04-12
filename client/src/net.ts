import * as assert from 'assert';
import * as fs from 'fs';
import fetch from 'node-fetch';
import * as stream from 'stream';
import * as util from 'util';
import * as vscode from 'vscode';

// See https://github.com/rust-lang/vscode-rust/blob/master/src/net.ts

const pipeline = util.promisify(stream.pipeline);

const GITHUB_API_ENDPOINT_URL = 'https://api.github.com';

export async function fetchAvailableReleases(
  owner: string,
  repository: string
): Promise<Array<GithubRelease>> {
  const apiEndpointPath = `/repos/${owner}/${repository}/releases`;

  const requestUrl = GITHUB_API_ENDPOINT_URL + apiEndpointPath;

  console.debug(
    `Issuing request for releases metadata to `,
    requestUrl
  );

  const response = await fetch(requestUrl, {
    headers: { Accept: 'application/vnd.github.v3+json'},
  });

  if (!response.ok) {
    console.error('Error fetching releases info', {
      requestUrl,
      response: {
        headers: response.headers,
        status: response.status,
        body: await response.text(),
      },
    });

    throw new Error(
      `Got response ${response.status} when trying to fetch ` + 
        `releases info for ${owner}/${repository}`
    );
  }
  const releases: Array<GithubRelease> = await (response.json()) as Array<GithubRelease>;
  return releases;
}

// We omit declaration of tremendous amount of fields that we are not using here
export interface GithubRelease {
  name: string;
  id: number;
  // eslint-disable-next-line camelcase
  published_at: string;
  assets: Array<{
    name: string;
    // eslint-disable-next-line camelcase
    browser_download_url: string;
  }>;
}

export async function download(
  downloadUrl: string,
  destinationPath: string,
  progressTitle: string,
  { mode }: { mode?: number } = {},
) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: false,
      title: progressTitle,
    },
    async (progress, _cancellationToken) => {
      let lastPercentage = 0;
      await downloadFile(
        downloadUrl,
        destinationPath,
        mode,
        (readBytes, totalBytes) => {
          const newPercentage = (readBytes / totalBytes) * 100;
          progress.report({
            message: newPercentage.toFixed(0) + '%',
            increment: newPercentage - lastPercentage,
          });

          lastPercentage = newPercentage;
        },
      );
    },
  );
}

/**
 * Downloads file from `url` and stores it at `destFilePath` with `destFilePermissions`.
 * `onProgress` callback is called on recieveing each chunk of bytes
 * to track the progress of downloading, it gets the already read and total
 * amount of bytes to read as its parameters.
 */
async function downloadFile(
  url: string,
  destFilePath: fs.PathLike,
  mode: number | undefined,
  onProgress: (readBytes: number, totalBytes: number) => void,
): Promise<void> {
  const res = await fetch(url);

  if (!res.ok) {
    console.error('Error', res.status, 'while downloading file from', url);
    console.error({ body: await res.text(), headers: res.headers });

    throw new Error(
      `Got response ${res.status} when trying to download a file.`,
    );
  }

  const totalBytes = Number(res.headers.get('content-length'));
  assert(!Number.isNaN(totalBytes), 'Sanity check of content-length protocol');

  console.debug(
    'Downloading file of',
    totalBytes,
    'bytes size from',
    url,
    'to',
    destFilePath,
  );

  let readBytes = 0;
  res.body.on('data', (chunk: Buffer) => {
    readBytes += chunk.length;
    onProgress(readBytes, totalBytes);
  });

  const destFileStream = fs.createWriteStream(destFilePath, { mode });

  await pipeline(res.body, destFileStream);
  // rust-analyzer uses a promise resolution here which does not seem to always work.
  // TODO: Look into this issue.
  // return new Promise<void>(resolve => {
  //  destFileStream.on('close', resolve);
  //  destFileStream.destroy();
  // });

  destFileStream.destroy();
}