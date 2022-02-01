import { GraphQLResult } from '@sourcegraph/http-client'
import { FlatExtensionHostAPI } from '@sourcegraph/shared/src/api/contract'
import { ProxySubscribable } from '@sourcegraph/shared/src/api/extension/api/common'
import { ViewerData, ViewerId } from '@sourcegraph/shared/src/api/viewerTypes'
import { AuthenticatedUser } from '@sourcegraph/shared/src/auth'
import { SearchMatch, StreamSearchOptions } from '@sourcegraph/shared/src/search/stream'
import { SettingsCascadeOrError } from '@sourcegraph/shared/src/settings/settings'

import { VSCEQueryState, VSCEState, VSCEStateMachine } from './state'

export interface ExtensionCoreAPI {
    /** For search panel webview to signal that it is ready for messages. */
    panelInitialized: (panelId: string) => void

    requestGraphQL: (request: string, variables: any, overrideAccessToken?: string) => Promise<GraphQLResult<any>>
    observeSourcegraphSettings: () => ProxySubscribable<SettingsCascadeOrError>
    getAuthenticatedUser: () => ProxySubscribable<AuthenticatedUser | null>
    getInstanceURL: () => ProxySubscribable<string>
    setAccessToken: (accessToken: string) => void
    /**
     * Observe search box query state.
     * Used to send current query from panel to sidebar.
     *
     * v1 Debt: Transient query state isn't stored in state machine for performance
     * as it would lead to re-rendering the whole search panel on each keystroke.
     * Implement selector system w/ key path for state machine. Alternatively,
     * aggressively memoize top-level "View" components (i.e. don't just take whole state as prop).
     */
    observePanelQueryState: () => ProxySubscribable<VSCEQueryState>

    observeState: () => ProxySubscribable<VSCEState>
    emit: VSCEStateMachine['emit']

    /** Opens a remote file given a serialized SourcegraphUri */
    openSourcegraphFile: (uri: string) => void
    openLink: (uri: string) => void
    copyLink: (uri: string) => void
    reloadWindow: () => void
    focusSearchPanel: () => void

    /**
     * Cancels previous search when called.
     */
    streamSearch: (query: string, options: StreamSearchOptions) => void
    fetchStreamSuggestions: (query: string, sourcegraphURL: string) => ProxySubscribable<SearchMatch[]>
    setSelectedSearchContextSpec: (spec: string) => void
    /**
     * Used to send current query from panel to sidebar.
     */
    setSidebarQueryState: (queryState: VSCEQueryState) => void
}

export interface SearchPanelAPI {
    ping: () => ProxySubscribable<'pong'>
}

export interface SearchSidebarAPI
    extends Pick<FlatExtensionHostAPI, 'addTextDocumentIfNotExists' | 'getDefinition' | 'getHover' | 'getReferences'> {
    ping: () => ProxySubscribable<'pong'>

    addViewerIfNotExists: (viewer: ViewerData) => Promise<ViewerId>
}
