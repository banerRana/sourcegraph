import puppeteer from 'puppeteer'
import { PUPPETEER_REVISIONS } from 'puppeteer/lib/cjs/puppeteer/revisions'
import signale from 'signale'

async function main(): Promise<void> {
    const browserName = process.env.BROWSER || 'chrome'
    if (browserName !== 'chrome' && browserName !== 'firefox') {
        signale.error(`Puppeteer browser must be "chrome" or "firefox", but got: "${browserName}"`)
        process.exit(1)
    }

    // Current puppeteer version (12.0.1) has a broken types
    // See https://github.com/puppeteer/puppeteer/issues/7100
    const browserFetcher = ((puppeteer as unknown) as puppeteer.PuppeteerNode).createBrowserFetcher({
        product: browserName,
    })
    const revision = PUPPETEER_REVISIONS[browserName === 'chrome' ? 'chromium' : 'firefox']
    const revisionInfo = browserFetcher.revisionInfo(revision)
    if (!revisionInfo.local) {
        signale.await(`Puppeteer browser: downloading ${browserName} revision ${revision}.`)
        const revisionInfo = await browserFetcher.download(revision)
        signale.success(`Done downloading browser to: ${revisionInfo.executablePath}`)
    } else {
        signale.success(`Puppeteer browser: found existing ${browserName} revision ${revision}, skipping download.`)
    }
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
