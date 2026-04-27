
export default function PrivacyPage() {
  return (
    <>
      <main className="flex-1 container mx-auto px-4 py-12 max-w-3xl prose prose-slate dark:prose-invert">
        <h1>Privacy Policy</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>
        
        <h2>1. Introduction</h2>
        <p>Welcome to SleeckOS. We respect your privacy and are committed to protecting your personal data. This privacy policy will inform you about how we look after your personal data when you visit our website and tell you about your privacy rights.</p>
        
        <h2>2. Data We Collect from TikTok</h2>
        <p>When you authenticate with our application, we use the TikTok API to collect the following information:</p>
        <ul>
          <li>Your TikTok username, display name, and avatar URL.</li>
          <li>Posting permissions to allow you to publish content via our app.</li>
        </ul>
        <p>We do not collect any other data from your TikTok profile.</p>

        <h2>3. Data Retention</h2>
        <p>We retain your authentication tokens and basic profile information only for as long as your account is connected. Access tokens are stored securely server-side. You can revoke access at any time from the Settings page.</p>
        
        <h2>4. Your Rights</h2>
        <p>Under GDPR and CCPA, you have the right to access, update, or delete the information we have on you. Please contact us to exercise these rights.</p>

        <h2>5. Contact Us</h2>
        <p>If you have any questions about this Privacy Policy, please contact us at support@example.com.</p>
      </main>
    </>
  );
}
