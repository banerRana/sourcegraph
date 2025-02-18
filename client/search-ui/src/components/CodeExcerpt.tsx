import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import { mdiAlertCircle } from '@mdi/js'
import classNames from 'classnames'
import { range } from 'lodash'
import VisibilitySensor from 'react-visibility-sensor'
import { Observable, Subscription, BehaviorSubject, of } from 'rxjs'
import { catchError, filter } from 'rxjs/operators'

import { HoverMerged } from '@sourcegraph/client-api'
import { DOMFunctions, findPositionsFromEvents, Hoverifier } from '@sourcegraph/codeintellify'
import { asError, ErrorLike, isDefined, isErrorLike, highlightNodeMultiline } from '@sourcegraph/common'
import { HighlightLineRange } from '@sourcegraph/search'
import { ActionItemAction } from '@sourcegraph/shared/src/actions/ActionItem'
import { ViewerId } from '@sourcegraph/shared/src/api/viewerTypes'
import { HighlightResponseFormat } from '@sourcegraph/shared/src/graphql-operations'
import { HoverContext } from '@sourcegraph/shared/src/hover/HoverOverlay.types'
import { Repo } from '@sourcegraph/shared/src/util/url'
import { Icon, Code } from '@sourcegraph/wildcard'

import styles from './CodeExcerpt.module.scss'

export interface Shape {
    top?: number
    left?: number
    bottom?: number
    right?: number
}

export interface FetchFileParameters {
    repoName: string
    commitID: string
    filePath: string
    disableTimeout?: boolean
    ranges: HighlightLineRange[]
    format?: HighlightResponseFormat
}

interface Props extends Repo {
    commitID: string
    filePath: string
    highlightRanges: HighlightRange[]
    /** The 0-based (inclusive) line number that this code excerpt starts at */
    startLine: number
    /** The 0-based (exclusive) line number that this code excerpt ends at */
    endLine: number
    className?: string
    /** A function to fetch the range of lines this code excerpt will display. It will be provided
     * the same start and end lines properties that were provided as component props */
    fetchHighlightedFileRangeLines: (startLine: number, endLine: number) => Observable<string[]>
    /** A function to fetch the range of lines this code excerpt will display. It will be provided
     * the same start and end lines properties that were provided as component props */
    fetchPlainTextFileRangeLines?: (startLine: number, endLine: number) => Observable<string[]>
    blobLines?: string[]

    viewerUpdates?: Observable<{ viewerId: ViewerId } & HoverContext>
    hoverifier?: Hoverifier<HoverContext, HoverMerged, ActionItemAction>
    visibilityOffset?: Shape
    onCopy?: () => void
}

export interface HighlightRange {
    /**
     * The 0-based line number where this highlight range begins
     */
    startLine: number
    /**
     * The 0-based character offset from the beginning of startLine where this highlight range begins
     */
    startCharacter: number
    /**
     * The 0-based line number where this highlight range ends
     */
    endLine: number
    /**
     * The 0-based character offset from the beginning of endLine where this highlight range ends
     */
    endCharacter: number
}

const domFunctions: DOMFunctions = {
    getCodeElementFromTarget: target => {
        const row = target.closest('tr')
        if (!row) {
            return null
        }
        return row.cells[1]
    },
    getCodeElementFromLineNumber: (codeView: HTMLElement, line: number): HTMLTableCellElement | null => {
        const lineElement = codeView.querySelector(`td[data-line="${line}"]`)
        if (!lineElement) {
            return null
        }
        const row = lineElement.closest('tr')
        if (!row) {
            return null
        }
        return row.cells[1]
    },
    getLineNumberFromCodeElement: codeCell => {
        const row = codeCell.closest('tr')
        if (!row) {
            throw new Error('Could not find closest row for codeCell')
        }
        const numberCell = row.cells[0]
        if (!numberCell || !numberCell.dataset.line) {
            throw new Error('Could not find line number')
        }
        return parseInt(numberCell.dataset.line, 10)
    },
}

const makeTableHTML = (blobLines: string[]): string => '<table>' + blobLines.join('') + '</table>'
const DEFAULT_VISIBILITY_OFFSET: Shape = { bottom: -500 }

/**
 * A code excerpt that displays syntax highlighting and match range highlighting.
 */
export const CodeExcerpt: React.FunctionComponent<Props> = ({
    blobLines,
    fetchHighlightedFileRangeLines,
    fetchPlainTextFileRangeLines,
    startLine,
    endLine,
    highlightRanges,
    viewerUpdates,
    hoverifier,
    visibilityOffset = DEFAULT_VISIBILITY_OFFSET,
    className,
    onCopy,
}) => {
    const [plainTextBlobLinesOrError, setPlainTextBlobLinesOrError] = useState<string[] | ErrorLike | null>(null)
    const [highlightedBlobLinesOrError, setHighlightedBlobLinesOrError] = useState<string[] | ErrorLike | null>(null)
    const [isVisible, setIsVisible] = useState(false)

    const blobLinesOrError = fetchPlainTextFileRangeLines
        ? highlightedBlobLinesOrError || plainTextBlobLinesOrError
        : highlightedBlobLinesOrError

    // Both the behavior subject and the React state are needed here. The behavior subject is
    // used for hoverified events while the React state is used for match highlighting.
    // The state is needed because React won't re-render when the behavior subject's value changes.
    const tableContainerElements = useMemo(() => new BehaviorSubject<HTMLElement | null>(null), [])
    const [tableContainerElement, setTableContainerElement] = useState<HTMLElement | null>(null)
    const updateTableContainerElementReference = useCallback(
        (reference: HTMLElement | null): void => {
            tableContainerElements.next(reference)
            setTableContainerElement(reference)
        },
        [tableContainerElements]
    )

    // Get the plain text (unhighlighted) blob lines
    useEffect(() => {
        let subscription: Subscription | undefined
        if (isVisible && fetchPlainTextFileRangeLines) {
            subscription = fetchPlainTextFileRangeLines(startLine, endLine).subscribe(blobLinesOrError => {
                setPlainTextBlobLinesOrError(blobLinesOrError)
            })
        }
        return () => subscription?.unsubscribe()
    }, [blobLines, endLine, fetchPlainTextFileRangeLines, isVisible, startLine])

    // Get the syntax highlighted blob lines
    useEffect(() => {
        let subscription: Subscription | undefined
        if (isVisible) {
            const observable = blobLines ? of(blobLines) : fetchHighlightedFileRangeLines(startLine, endLine)
            subscription = observable.pipe(catchError(error => [asError(error)])).subscribe(blobLinesOrError => {
                setHighlightedBlobLinesOrError(blobLinesOrError)
            })
        }
        return () => subscription?.unsubscribe()
    }, [blobLines, endLine, fetchHighlightedFileRangeLines, isVisible, startLine])

    // Highlight the search matches
    useLayoutEffect(() => {
        if (tableContainerElement) {
            const visibleRows = tableContainerElement.querySelectorAll<HTMLTableRowElement>('table tr')
            for (const highlight of highlightRanges) {
                // Select the HTML rows in the excerpt that correspond to the first and last line to be highlighted.
                // highlight.startLine is the 0-indexed line number in the code file, and startLine is the 0-indexed
                // line number of the first visible line in the excerpt. So, subtract startLine
                // from highlight.startLine to get the correct 0-based index in visibleRows that holds the HTML row
                // where highlighting should begin. Subtract startLine from highlight.endLine to get the correct 0-based
                // index in visibleRows that holds the HTML row where highlighting should end.
                const startRowIndex = highlight.startLine - startLine
                const endRowIndex = highlight.endLine - startLine
                const startRow = visibleRows[startRowIndex]
                const endRow = visibleRows[endRowIndex]
                if (startRow && endRow) {
                    highlightNodeMultiline(
                        visibleRows,
                        startRow,
                        endRow,
                        startRowIndex,
                        endRowIndex,
                        highlight.startCharacter,
                        highlight.endCharacter
                    )
                }
            }
        }
    }, [highlightRanges, startLine, endLine, tableContainerElement, blobLinesOrError])

    // Hook up the hover tooltips
    useEffect(() => {
        let hoverifierSubscription: Subscription | null

        const subscription = viewerUpdates?.subscribe(({ viewerId, ...hoverContext }) => {
            if (hoverifier) {
                if (hoverifierSubscription) {
                    hoverifierSubscription.unsubscribe()
                }

                hoverifierSubscription = hoverifier.hoverify({
                    positionEvents: tableContainerElements.pipe(
                        filter(isDefined),
                        findPositionsFromEvents({ domFunctions })
                    ),
                    resolveContext: () => hoverContext,
                    dom: domFunctions,
                })
            }
        })

        return () => {
            subscription?.unsubscribe()
            hoverifierSubscription?.unsubscribe()
        }
    }, [hoverifier, tableContainerElements, viewerUpdates])

    return (
        <VisibilitySensor onChange={setIsVisible} partialVisibility={true} offset={visibilityOffset}>
            <Code
                data-testid="code-excerpt"
                onCopy={onCopy}
                className={classNames(
                    styles.codeExcerpt,
                    className,
                    isErrorLike(blobLinesOrError) && styles.codeExcerptError
                )}
            >
                {blobLinesOrError && !isErrorLike(blobLinesOrError) && (
                    <div
                        ref={updateTableContainerElementReference}
                        dangerouslySetInnerHTML={{ __html: makeTableHTML(blobLinesOrError) }}
                    />
                )}
                {blobLinesOrError && isErrorLike(blobLinesOrError) && (
                    <div className={styles.codeExcerptAlert}>
                        <Icon className="mr-2" aria-hidden={true} svgPath={mdiAlertCircle} />
                        {blobLinesOrError.message}
                    </div>
                )}
                {!blobLinesOrError && (
                    <table>
                        <tbody>
                            {range(startLine, endLine).map(index => (
                                <tr key={index}>
                                    <td className="line" data-line={index + 1} />
                                    {/* create empty space to fill viewport (as if the blob content were already fetched, otherwise we'll overfetch) */}
                                    <td className="code"> </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Code>
        </VisibilitySensor>
    )
}
