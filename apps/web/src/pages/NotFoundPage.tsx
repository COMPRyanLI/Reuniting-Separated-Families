import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="narrow">
      <h1>Page not found</h1>
      <p>This page does not exist or is not available to you.</p>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </div>
  );
}
