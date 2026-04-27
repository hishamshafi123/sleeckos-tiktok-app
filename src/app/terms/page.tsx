import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function TermsPage() {
  return (
    <>
      <Header />
      <main className="flex-1 container mx-auto px-4 py-12 max-w-3xl prose prose-slate dark:prose-invert">
        <h1>Terms of Service</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>
        
        <h2>1. Agreement to Terms</h2>
        <p>By using SleeckOS, you agree to these Terms of Service. If you disagree with any part of the terms, you may not access the service.</p>
        
        <h2>2. Acceptable Use</h2>
        <p>You agree to use the service only for lawful purposes. You must own the rights to any content you publish through our service. We are not responsible for the content you choose to publish.</p>
        
        <h2>3. TikTok Policies</h2>
        <p>This application is not operated by or affiliated with TikTok. By using our service to publish to TikTok, you agree that TikTok's own Music Usage Confirmation and Branded Content Policy apply to all your posts.</p>

        <h2>4. Limitation of Liability</h2>
        <p>In no event shall SleeckOS be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from your access to or use of or inability to access or use the service.</p>

        <h2>5. Changes</h2>
        <p>We reserve the right to modify or replace these Terms at any time. We will try to provide at least 30 days notice prior to any new terms taking effect.</p>
      </main>
      <Footer />
    </>
  );
}
