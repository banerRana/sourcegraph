import { Settings, SettingsCascadeOrError } from '@sourcegraph/shared/src/settings/settings'
import { getExperimentalFeatures } from '../../util/get-experimental-features'
import { allFuzzyActions, FuzzyAction, FuzzyActionProps } from './FuzzyAction'

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
    public constructor(public readonly tabs: Tabs, public readonly actions: FuzzyAction[]) {}
    public all(): Tab[] {
        return [this.tabs.all, this.tabs.actions, this.tabs.repos, this.tabs.files, this.tabs.lines]
    }
    public isAllHidden(): boolean {
        return this.all().find(tab => tab.state !== TabState.Hidden) === undefined
    }
}

export interface FuzzyTabsProps extends FuzzyActionProps {
    settingsCascade: SettingsCascadeOrError<Settings>
    isRepositoryRelatedPage: boolean
}

export function useFuzzyTabs(props: FuzzyTabsProps): FuzzyTabs {
    let { fuzzyFinderActions } = getExperimentalFeatures(props.settingsCascade.final) ?? false
    return new FuzzyTabs(
        {
            all: hiddenKind,
            actions: fuzzyFinderActions ? defaultKinds.actions : hiddenKind,
            repos: hiddenKind,
            files: props.isRepositoryRelatedPage ? defaultKinds.files : hiddenKind,
            symbols: hiddenKind,
            lines: hiddenKind,
        },
        allFuzzyActions(props)
    )
}
