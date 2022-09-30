import { isErrorLike } from '@sourcegraph/common'
import {
    ConfiguredSubjectOrError,
    Settings,
    SettingsCascade,
    SettingsCascadeOrError,
} from '@sourcegraph/shared/src/settings/settings'

enum TabState {
    Hidden,
    Disabled,
    Enabled,
    Active,
}

interface Tab {
    title: string
    state: TabState
}
const defaultKinds: Tabs = {
    all: { title: 'All', state: TabState.Enabled },
    actions: { title: 'Actions', state: TabState.Enabled },
    repos: { title: 'Repos', state: TabState.Enabled },
    files: { title: 'Files', state: TabState.Enabled },
    symbols: { title: 'Symbols', state: TabState.Enabled },
    lines: { title: 'Lines', state: TabState.Enabled },
}
const hiddenKind = { title: 'Hidden', state: TabState.Hidden }

export interface Tabs {
    all: Tab
    actions: Tab
    repos: Tab
    files: Tab
    symbols: Tab
    lines: Tab
}
export class FuzzyTabs {
    public constructor(readonly tabs: Tabs) {}
    private all(): Tab[] {
        return [this.tabs.all, this.tabs.actions, this.tabs.repos, this.tabs.files, this.tabs.lines]
    }
    public isAllHidden(): boolean {
        return this.all().find(tab => tab.state !== TabState.Hidden) === undefined
    }
}

export function useFuzzyTabs(
    settingsCascade: SettingsCascadeOrError<Settings>,
    isRepositoryRelatedPage: boolean
): FuzzyTabs {
    const actions =
        (settingsCascade !== null &&
            !isErrorLike(settingsCascade.final) &&
            settingsCascade.final !== null &&
            settingsCascade.final?.experimentalFeatures?.fuzzyFinderActions) ??
        false
    return new FuzzyTabs({
        all: hiddenKind,
        actions: actions ? defaultKinds.actions : hiddenKind,
        repos: hiddenKind,
        files: isRepositoryRelatedPage ? defaultKinds.files : hiddenKind,
        symbols: hiddenKind,
        lines: hiddenKind,
    })
}
