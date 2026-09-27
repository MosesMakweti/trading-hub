import { Download, ExternalLink } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CONNECT_STEPS,
  DIRECT_INSTALL_STEPS,
  EXTENSION_DISTRIBUTION,
  EXTENSION_MIN_CHROME_VERSION,
  EXTENSION_RELEASE_LABEL,
  EXTENSION_VERSION,
  extensionCta,
  type ExtensionDistribution,
} from "@/lib/extension-distribution";

/**
 * Settings → Integrations: "Traditorium for TradingView" — download/install,
 * connect, browser support and the permissions notice. Stateless (native
 * <details> disclosures), so it renders on the server. Everything that
 * varies by distribution channel comes from `extension-distribution.ts`.
 */

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border/70 px-3 py-2 text-sm [&[open]]:pb-3">
      <summary className="cursor-pointer select-none font-medium marker:text-muted-foreground">{title}</summary>
      <div className="mt-2 space-y-2 text-muted-foreground">{children}</div>
    </details>
  );
}

function Steps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

export function ExtensionInstallCard({ distribution = EXTENSION_DISTRIBUTION }: { distribution?: ExtensionDistribution }) {
  const cta = extensionCta(distribution);
  const direct = distribution.channel === "direct-download";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Traditorium for TradingView</CardTitle>
        <CardDescription>Analyze on TradingView and send Trade Ideas directly into Traditorium.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href={cta.href}
            {...(cta.download ? { download: cta.download } : {})}
            {...(cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className={buttonVariants({ size: "lg" })}
          >
            {cta.external ? <ExternalLink className="size-3.5" /> : <Download className="size-3.5" />}
            {cta.label}
          </a>
          <div className="text-xs text-muted-foreground">
            <div data-testid="extension-version">
              Version {EXTENSION_VERSION} · {EXTENSION_RELEASE_LABEL}
            </div>
            <div>Google Chrome / Chromium {EXTENSION_MIN_CHROME_VERSION}+ · Edge: compatible but unverified</div>
          </div>
        </div>

        <div className="space-y-2">
          {direct && (
            <Disclosure title="How to install">
              <p>
                During the private beta the extension is installed manually with Chrome&apos;s Developer mode. Chrome
                can&apos;t install the ZIP directly — unzip it first, then load the folder. This step goes away once
                the extension is on the Chrome Web Store.
              </p>
              <Steps steps={DIRECT_INSTALL_STEPS} />
            </Disclosure>
          )}
          <Disclosure title="How to connect">
            <Steps steps={CONNECT_STEPS} />
            <p>
              The token is shown only once, right after you create it. Treat it like a password — don&apos;t share it
              or paste it anywhere except the extension. Revoke it below at any time.
            </p>
          </Disclosure>
          <Disclosure title="Permissions & privacy">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Chart integration runs only on TradingView (tradingview.com). The extension talks to Traditorium
                (traditorium.com) with your token.
              </li>
              <li>
                Chrome will say the extension can &ldquo;read and change all your data on all websites&rdquo;. That
                broad access (<code>&lt;all_urls&gt;</code>) is required by Chrome&apos;s screenshot API for the
                Capture Chart button; the extension only captures a TradingView tab.
              </li>
              <li>Screenshots are taken only when you click Capture Chart (or Retake).</li>
            </ul>
          </Disclosure>
        </div>
      </CardContent>
    </Card>
  );
}
