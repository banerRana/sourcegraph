import React, { useState, useEffect, Dispatch, SetStateAction, useMemo } from 'react'

import { ApolloError, useQuery } from '@apollo/client'
import * as H from 'history'
import { useHistory } from 'react-router-dom'

import { gql, getDocumentNode } from '@sourcegraph/http-client'
import { useKeyboardShortcut } from '@sourcegraph/shared/src/keyboardShortcuts/useKeyboardShortcut'
import { Shortcut } from '@sourcegraph/shared/src/react-shortcuts'
import { TelemetryProps } from '@sourcegraph/shared/src/telemetry/telemetryService'

import { FuzzySearch, SearchIndexing } from '../../fuzzyFinder/FuzzySearch'
import { FileNamesResult, FileNamesVariables } from '../../graphql-operations'
import { parseBrowserRepoURL } from '../../util/url'

import { FuzzyModal, FuzzyModalProps } from './FuzzyModal'
import { SettingsCascadeProps } from '@sourcegraph/shared/src/settings/settings'
import { FuzzyTabsProps, useFuzzyTabs } from './FuzzyTabs'

const DEFAULT_MAX_RESULTS = 100

interface FuzzyFinderContainerProps
    extends TelemetryProps,
        Pick<FuzzyFinderProps, 'location'>,
        SettingsCascadeProps,
        FuzzyTabsProps {}

/**
 * This components registers a global keyboard shortcut to render the fuzzy
 * finder and renders the fuzzy finder.
 */
export const FuzzyFinderContainer: React.FunctionComponent<FuzzyFinderContainerProps> = props => {
    const [isVisible, setIsVisible] = useState(false)
    const [retainFuzzyFinderCache, setRetainFuzzyFinderCache] = useState(true)
    const fuzzyFinderShortcut = useKeyboardShortcut('fuzzyFinder')
    const tabs = useMemo(() => useFuzzyTabs(props), [props, props.isRepositoryRelatedPage])

    useEffect(() => {
        if (isVisible) {
            props.telemetryService.log('FuzzyFinderViewed', { action: 'shortcut open' })
        }
    }, [props.telemetryService, isVisible])

    if (tabs.isAllHidden()) {
        return null
    }

    return (
        <>
            {fuzzyFinderShortcut?.keybindings.map((keybinding, index) => (
                <Shortcut
                    key={index}
                    {...keybinding}
                    onMatch={() => {
                        setIsVisible(true)
                        setRetainFuzzyFinderCache(true)
                        const input = document.querySelector<HTMLInputElement>('#fuzzy-modal-input')
                        input?.focus()
                        input?.select()
                    }}
                    ignoreInput={true}
                />
            ))}
            {retainFuzzyFinderCache && (
                <FuzzyFinder
                    tabs={tabs}
                    setIsVisible={bool => setIsVisible(bool)}
                    isVisible={isVisible}
                    location={props.location}
                    setCacheRetention={bool => setRetainFuzzyFinderCache(bool)}
                />
            )}
        </>
    )
}

interface FuzzyFinderProps extends Pick<FuzzyModalProps, 'tabs'> {
    setIsVisible: Dispatch<SetStateAction<boolean>>

    isVisible: boolean

    location: H.Location

    setCacheRetention: Dispatch<SetStateAction<boolean>>

    /**
     * The maximum number of files a repo can have to use case-insensitive fuzzy finding.
     *
     * Case-insensitive fuzzy finding is more expensive to compute compared to
     * word-sensitive fuzzy finding.  The fuzzy modal will use case-insensitive
     * fuzzy finding when the repo has fewer files than this number, and
     * word-sensitive fuzzy finding otherwise.
     */
    caseInsensitiveFileCountThreshold?: number
}

const FuzzyFinder: React.FunctionComponent<React.PropsWithChildren<FuzzyFinderProps>> = ({
    location: { search, pathname, hash },
    setCacheRetention,
    setIsVisible,
    isVisible,
    tabs,
}) => {
    // The state machine of the fuzzy finder. See `FuzzyFSM` for more details
    // about the state transititions.
    const [fsm, setFsm] = useState<FuzzyFSM>({ key: 'empty' })
    const { repoName = '', commitID = '', rawRevision = '' } = parseBrowserRepoURL(pathname + search + hash)
    const { downloadFilename, isLoadingFilename, filenameError } = useFilename(repoName, commitID || rawRevision)

    const history = useHistory()
    useEffect(
        () =>
            history.listen(location => {
                const url = location.pathname + location.search + location.hash
                const { repoName: repo = '', commitID: commit = '', rawRevision: raw = '' } = parseBrowserRepoURL(url)
                if (repo !== repoName || commit !== commitID || raw !== rawRevision) {
                    setCacheRetention(false)
                }
            }),
        [history, repoName, commitID, rawRevision, setCacheRetention]
    )

    if (!isVisible) {
        return null
    }

    return (
        <FuzzyModal
            tabs={tabs}
            repoName={repoName}
            commitID={commitID}
            initialMaxResults={DEFAULT_MAX_RESULTS}
            initialQuery=""
            downloadFilenames={downloadFilename}
            isLoading={isLoadingFilename}
            isError={filenameError}
            onClose={() => setIsVisible(false)}
            fsm={fsm}
            setFsm={setFsm}
        />
    )
}

/**
 * The fuzzy finder modal is implemented as a state machine with the following transitions:
 *
 * ```
 *   ╭────[cached]───────────────────────╮  ╭──╮
 *   │                                   v  │  v
 * Empty ─[uncached]───> Downloading ──> Indexing ──> Ready
 *                       ╰──────────────────────> Failed
 * ```
 *
 * - Empty: start state.
 * - Downloading: downloading filenames from the remote server. The filenames
 *                are cached using the browser's CacheStorage, if available.
 * - Indexing: processing the downloaded filenames. This step is usually
 *             instant, unless the repo is very large (>100k source files).
 *             In the torvalds/linux repo (~70k files), this step takes <1s
 *             on my computer but the chromium/chromium repo (~360k files)
 *             it takes ~3-5 seconds. This step is async so that the user can
 *             query against partially indexed results.
 * - Ready: all filenames have been indexed.
 * - Failed: something unexpected happened, the user can't fuzzy find files.
 */
export type FuzzyFSM = Empty | Downloading | Indexing | Ready | Failed
export interface Empty {
    key: 'empty'
}
export interface Downloading {
    key: 'downloading'
}
export interface Indexing {
    key: 'indexing'
    indexing: SearchIndexing
}
export interface Ready {
    key: 'ready'
    fuzzy: FuzzySearch
}
export interface Failed {
    key: 'failed'
    errorMessage: string
}

const FILE_NAMES = gql`
    query FileNames($repository: String!, $commit: String!) {
        repository(name: $repository) {
            id
            commit(rev: $commit) {
                id
                fileNames
            }
        }
    }
`

interface FilenameResult {
    downloadFilename: string[]
    isLoadingFilename: boolean
    filenameError: ApolloError | undefined
}

const useFilename = (repository: string, commit: string): FilenameResult => {
    const { data, loading, error } = useQuery<FileNamesResult, FileNamesVariables>(getDocumentNode(FILE_NAMES), {
        variables: { repository, commit },
    })

    return {
        downloadFilename: data?.repository?.commit?.fileNames || [],
        isLoadingFilename: loading,
        filenameError: error,
    }
}
