export type ExistingFilePolicy = 'error' | 'replace'

export interface ExistingFileDetails {
  fileName?: string
  extension?: string
}

export class ServiceRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ExistingFileDetails,
  ) { super(message) }
}

export const runUserDownloads = async<T>(
  items: T[],
  request: (item: T, policy: ExistingFilePolicy) => Promise<unknown>,
  confirmReplace: (details: ExistingFileDetails) => Promise<boolean>,
): Promise<void> => {
  for (const item of items) {
    try {
      await request(item, 'error')
    } catch (error) {
      if (!(error instanceof ServiceRequestError) || error.code !== 'DOWNLOAD_ALREADY_EXISTS') throw error
      if (await confirmReplace(error.details ?? {})) await request(item, 'replace')
    }
  }
}
