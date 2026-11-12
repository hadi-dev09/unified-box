import { LegalPage } from "../legal";

export const metadata = { title: "Terms · Unified Box" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="November 13, 2026">
      <p>By creating an account you agree to these terms.</p>
      <h2>The service</h2>
      <p>Unified Box shows messages from accounts you connect and lets you, or AI assistants you connect, draft replies. It is currently in beta and provided “as is”; features may change.</p>
      <h2>Your responsibilities</h2>
      <ul>
        <li>Only connect accounts and workspaces you are allowed to access, and follow their rules (including your clients&apos; and employers&apos; policies).</li>
        <li>You are responsible for messages you approve and send.</li>
        <li>Keep your password and access keys safe.</li>
      </ul>
      <h2>AI assistants</h2>
      <p>AI-generated drafts may be wrong. Review every draft before approving it. AI assistants you connect are operated by their own providers under their own terms.</p>
      <h2>Ending your use</h2>
      <p>You can disconnect accounts and stop using the service at any time. We may suspend accounts that abuse the service or put others at risk.</p>
      <h2>Liability</h2>
      <p>To the extent the law allows, Unified Box is not liable for indirect losses or for messages sent with your approval.</p>
    </LegalPage>
  );
}
