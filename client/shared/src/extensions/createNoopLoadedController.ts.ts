import * as comlink from 'comlink'
import { NEVER, Observable } from 'rxjs'
import { map } from 'rxjs/operators'

import { TextDocumentPositionParameters } from '@sourcegraph/client-api'
import { MaybeLoadingResult } from '@sourcegraph/codeintellify'

import { FlatExtensionHostAPI } from '../api/contract'
import { proxySubscribable } from '../api/extension/api/common'
import { createExtensionHostAPI } from '../api/extension/extensionHostApi'
import { createExtensionHostState } from '../api/extension/extensionHostState'
import { pretendRemote } from '../api/util'
import { newCodeIntelAPI } from '../codeintel/api'
import { CodeIntelContext } from '../codeintel/legacy-extensions/api'
import { PlatformContext } from '../platform/context'
import { isSettingsValid } from '../settings/settings'

import { Controller } from './controller'

export function createNoopController(platformContext: PlatformContext): Controller {
    return {
        executeCommand: () => Promise.resolve(),
        commandErrors: NEVER,
        registerCommand: () => ({
            unsubscribe: () => {},
        }),
        extHostAPI: new Promise((resolve, reject) => {
            platformContext.settings.subscribe(settingsCascade => {
                if (!isSettingsValid(settingsCascade)) {
                    reject(new Error('Settings are not valid'))
                    return
                }

                const extensionHostState = createExtensionHostState(
                    {
                        clientApplication: 'sourcegraph',
                        initialSettings: settingsCascade,
                    },
                    null,
                    null
                )
                const extensionHostAPI = injectNewCodeintel(pretendRemote(createExtensionHostAPI(extensionHostState)), {
                    requestGraphQL: platformContext.requestGraphQL,
                    telemetryService: platformContext.telemetryService,
                    settings: platformContext.settings,
                    // TODO searchContext: ???
                })

                resolve(extensionHostAPI)
            })
        }),

        unsubscribe: () => {},
    }
}

// Replaces codeintel functions from the "old" extension/webworker extension API
// with new implementations of code that lives in this repository. The old
// implementation invoked codeintel functions via webworkers, and the codeintel
// implementation lived in a separate repository
// https://github.com/sourcegraph/code-intel-extensions Ideally, we should
// update all the usages of `comlink.Remote<FlatExtensionHostAPI>` with the new
// `CodeIntelAPI` interfaces, but that would require refactoring a lot of files.
// To minimize the risk of breaking changes caused by the deprecation of
// extensions, we monkey patch the old implementation with new implementations.
// The benefit of monkey patching is that we can optionally disable if for
// customers that choose to enable the legacy extensions.
export function injectNewCodeintel(
    old: comlink.Remote<FlatExtensionHostAPI>,
    context: CodeIntelContext
): comlink.Remote<FlatExtensionHostAPI> {
    const codeintel = newCodeIntelAPI(context)
    function thenMaybeLoadingResult<T>(promise: Observable<T>): Observable<MaybeLoadingResult<T>> {
        return promise.pipe(
            map(result => {
                const maybeLoadingResult: MaybeLoadingResult<T> = { isLoading: false, result }
                return maybeLoadingResult
            })
        )
    }

    const codeintelOverrides: Pick<
        FlatExtensionHostAPI,
        | 'getHover'
        | 'getDocumentHighlights'
        | 'getReferences'
        | 'getDefinition'
        | 'getLocations'
        | 'hasReferenceProvidersForDocument'
    > = {
        hasReferenceProvidersForDocument(textParameters) {
            return proxySubscribable(codeintel.hasReferenceProvidersForDocument(textParameters))
        },
        getLocations(id, parameters) {
            console.log({ id })
            return proxySubscribable(thenMaybeLoadingResult(codeintel.getImplementations(parameters)))
        },
        getDefinition(parameters) {
            return proxySubscribable(thenMaybeLoadingResult(codeintel.getDefinition(parameters)))
        },
        getReferences(parameters, context) {
            console.log({ parameters })
            return proxySubscribable(thenMaybeLoadingResult(codeintel.getReferences(parameters, context)))
        },
        getDocumentHighlights: (textParameters: TextDocumentPositionParameters) =>
            proxySubscribable(codeintel.getDocumentHighlights(textParameters)),
        getHover: (textParameters: TextDocumentPositionParameters) =>
            proxySubscribable(thenMaybeLoadingResult(codeintel.getHover(textParameters))),
    }

    return new Proxy(old, {
        get(target, prop) {
            const codeintelFunction = (codeintelOverrides as any)[prop]
            if (codeintelFunction) {
                return codeintelFunction
            }
            return Reflect.get(target, prop, ...arguments)
        },
    })
}
