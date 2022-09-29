package config

import (
	"fmt"
	"net"

	"github.com/sourcegraph/sourcegraph/internal/version"
)

const (
	// DefaultIgniteVersion is the sourcegraph/ignite version to be used by this
	// executor build.
	DefaultIgniteVersion = "v0.10.4"
	// DefaultFirecrackerKernelImage is the kernel source image to extract the vmlinux
	// image from.
	DefaultFirecrackerKernelImage = "sourcegraph/ignite-kernel:5.10.135-amd64"
	// CNIBinDir is the dir where ignite expects the CNI plugins to be installed to.
	CNIBinDir = "/opt/cni/bin"
)

var (
	// DefaultFirecrackerSandboxImage is the isolation image used to run firecracker
	// from ignite.
	DefaultFirecrackerSandboxImage = fmt.Sprintf("sourcegraph/ignite:%s", DefaultIgniteVersion)
	// DefaultFirecrackerImage is the VM image to use with firecracker. Will be imported
	// from the docker image.
	DefaultFirecrackerImage = func() string {
		tag := version.Version()
		// In dev, just use insiders for convenience.
		if version.IsDev(tag) {
			tag = "insiders"
		}
		return fmt.Sprintf("sourcegraph/executor-vm:%s", tag)
	}()
	// RequiredCNIPlugins is the list of CNI binaries that are expected to exist when using
	// firecracker.
	RequiredCNIPlugins = []string{
		// Used to throttle bandwidth per VM so that none can drain the host completely.
		"bandwidth",
		"bridge",
		"firewall",
		"host-local",
		// Used to isolate the ignite bridge from other bridges.
		"isolation",
		"loopback",
		// Needed by ignite, but we don't actually do port mapping.
		"portmap",
	}
	// RequiredCLITools contains all the programs that are expected to exist in
	// PATH when running the executor.
	RequiredCLITools = []string{"docker", "git", "src"}
	// RequiredCLIToolsFirecracker contains all the programs that are expected to
	// exist in PATH when running the executor with firecracker enabled.
	RequiredCLIToolsFirecracker = []string{"dmsetup", "losetup", "mkfs.ext4"}
	// CNISubnetCIDR is the CIDR range of the VMs in firecracker. This is the ignite
	// default and chosen so that it doesn't interfere with other common applications
	// such as docker. It also provides room for a large number of VMs.
	CNISubnetCIDR = mustParseCIDR("10.61.0.0/16")
)

func mustParseCIDR(val string) *net.IPNet {
	_, net, err := net.ParseCIDR(val)
	if err != nil {
		panic(err)
	}
	return net
}
