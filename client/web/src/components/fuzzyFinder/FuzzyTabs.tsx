import { Settings, SettingsCascadeOrError } from '@sourcegraph/shared/src/settings/settings'
import { getExperimentalFeatures } from '../../util/get-experimental-features'

enum TabState {
    Hidden,
    Disabled,
    Enabled,
    Active,
}

class Tab {
    public constructor(public readonly title: string, public readonly state: TabState) {}
    public isVisible(): boolean {
        return this.state !== TabState.Hidden
    }
}

const defaultKinds: Tabs = {
    all: new Tab('All', TabState.Enabled),
    actions: new Tab('Actions', TabState.Enabled),
    repos: new Tab('Repos', TabState.Enabled),
    files: new Tab('Files', TabState.Enabled),
    symbols: new Tab('Symbols', TabState.Enabled),
    lines: new Tab('Lines', TabState.Enabled),
}
const hiddenKind: Tab = new Tab('Hidden', TabState.Hidden)

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
    public all(): Tab[] {
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
    let { fuzzyFinderActions } = getExperimentalFeatures(settingsCascade.final) ?? false
    return new FuzzyTabs({
        all: hiddenKind,
        actions: fuzzyFinderActions ? defaultKinds.actions : hiddenKind,
        repos: hiddenKind,
        files: isRepositoryRelatedPage ? defaultKinds.files : hiddenKind,
        symbols: hiddenKind,
        lines: hiddenKind,
    })
}
