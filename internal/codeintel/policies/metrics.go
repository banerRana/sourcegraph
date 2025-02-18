package policies

import (
	"github.com/prometheus/client_golang/prometheus"

	"github.com/sourcegraph/sourcegraph/internal/observation"
)

type matcherMetrics struct {
	numPoliciesUpdated prometheus.Counter
}

func newMetrics(observationContext *observation.Context) *matcherMetrics {
	counter := func(name, help string) prometheus.Counter {
		counter := prometheus.NewCounter(prometheus.CounterOpts{
			Name: name,
			Help: help,
		})

		observationContext.Registerer.MustRegister(counter)
		return counter
	}

	numPoliciesUpdated := counter(
		"src_codeintel_background_policies_updated_total",
		"The number of configuration policies whose repository membership list was updated.",
	)

	return &matcherMetrics{
		numPoliciesUpdated: numPoliciesUpdated,
	}
}
