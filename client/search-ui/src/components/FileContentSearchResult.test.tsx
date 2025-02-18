import { cleanup, getAllByTestId, getByTestId } from '@testing-library/react'
import { createBrowserHistory } from 'history'
import FileIcon from 'mdi-react/FileIcon'
import sinon from 'sinon'

import { ContentMatch } from '@sourcegraph/shared/src/search/stream'
import { NOOP_TELEMETRY_SERVICE } from '@sourcegraph/shared/src/telemetry/telemetryService'
import { renderWithBrandedContext } from '@sourcegraph/shared/src/testing'
import {
    HIGHLIGHTED_FILE_LINES_REQUEST,
    NOOP_SETTINGS_CASCADE,
    RESULT,
} from '@sourcegraph/shared/src/testing/searchTestHelpers'
import '@sourcegraph/shared/dev/mockReactVisibilitySensor'

import { FileContentSearchResult } from './FileContentSearchResult'

describe('FileContentSearchResult', () => {
    afterAll(cleanup)
    const history = createBrowserHistory()
    history.replace({ pathname: '/search' })
    const defaultProps = {
        index: 0,
        location: history.location,
        result: RESULT,
        icon: FileIcon,
        onSelect: sinon.spy(),
        defaultExpanded: true,
        showAllMatches: true,
        fetchHighlightedFileLineRanges: HIGHLIGHTED_FILE_LINES_REQUEST,
        settingsCascade: NOOP_SETTINGS_CASCADE,
        telemetryService: NOOP_TELEMETRY_SERVICE,
    }

    it('renders one result container', () => {
        const { container } = renderWithBrandedContext(<FileContentSearchResult {...defaultProps} />)
        expect(getByTestId(container, 'result-container')).toBeVisible()
        expect(getAllByTestId(container, 'result-container').length).toBe(1)
    })

    it('correctly shows number of context lines when search.contextLines setting is set', () => {
        const result: ContentMatch = {
            type: 'content',
            path: '.travis.yml',
            repository: 'github.com/golang/oauth2',
            chunkMatches: [
                {
                    content: '  - go test -v golang.org/x/oauth2/...',
                    contentStart: {
                        offset: 223,
                        line: 12,
                        column: 0,
                    },
                    ranges: [
                        {
                            start: {
                                offset: 230,
                                line: 12,
                                column: 7,
                            },
                            end: {
                                offset: 234,
                                line: 12,
                                column: 11,
                            },
                        },
                    ],
                },
            ],
        }
        const settingsCascade = {
            final: { 'search.contextLines': 3 },
            subjects: [
                {
                    lastID: 1,
                    settings: { 'search.contextLines': '3' },
                    extensions: null,
                    subject: {
                        __typename: 'User' as const,
                        username: 'f',
                        id: 'abc',
                        settingsURL: '/users/f/settings',
                        viewerCanAdminister: true,
                        displayName: 'f',
                    },
                },
            ],
        }
        const { container } = renderWithBrandedContext(
            <FileContentSearchResult {...defaultProps} result={result} settingsCascade={settingsCascade} />
        )
        const tableRows = container.querySelectorAll('[data-testid="code-excerpt"] tr')
        expect(tableRows.length).toBe(4)
    })
})
