import { ApolloError, gql, useQuery } from '@apollo/client'

import { CodeGraphInferenceScriptResult } from '../../../../graphql-operations'

interface UseInferenceScriptResult {
    inferenceScript: string
    loadingScript: boolean
    fetchError: ApolloError | undefined
}

const INFERENCE_SCRIPT = gql`
    query CodeGraphInferenceScript {
        codeIntelligenceInferenceScript
    }
`

export const useInferenceScript = (): UseInferenceScriptResult => {
    const { data, loading, error } = useQuery<CodeGraphInferenceScriptResult>(INFERENCE_SCRIPT)

    return {
        inferenceScript: data?.codeIntelligenceInferenceScript ?? '',
        loadingScript: loading,
        fetchError: error,
    }
}
