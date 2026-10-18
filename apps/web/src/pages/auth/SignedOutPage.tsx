import { Link } from 'react-router';
import { usePageTitle } from '../../components/PageTitle';

export function SignedOutPage() {
  usePageTitle('Signed out');
  return (
    <div className="narrow stack">
      <h1>You have signed out</h1>
      <p>Nothing from your session is kept on this page. Going back in the browser will not show your information.</p>
      <div className="alert alert-info">
        <p>
          On a shared or shelter computer, you can now hand it to the next person. Close the browser window if you want to be
          extra careful.
        </p>
      </div>
      <p>
        <Link to="/signin">Sign in again</Link> · <Link to="/">Home</Link>
      </p>
    </div>
  );
}
