import { ThemePreference, ThemeState } from '../../theme'

export class FuzzyAction {
    public constructor(public readonly id: string, public readonly title: string, public readonly run: () => void) {}
}

export interface FuzzyActionProps {
    themeState: ThemeState
}
export function allFuzzyActions(props: FuzzyActionProps): FuzzyAction[] {
    return [
        new FuzzyAction('toggle.theme', 'Toggle Between Dark/Light Theme', () => {
            switch (props.themeState.themePreference) {
                case ThemePreference.Dark:
                    return props.themeState.setThemePreference(ThemePreference.Light)
                case ThemePreference.Light:
                    return props.themeState.setThemePreference(ThemePreference.Dark)
                case ThemePreference.System:
            }
        }),
    ]
}
