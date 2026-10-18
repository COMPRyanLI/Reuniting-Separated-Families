import { useShelters } from '../lib/places';
import { Loading } from '../components/guards';
import { usePageTitle } from '../components/PageTitle';

export function SheltersPage() {
  usePageTitle('Shelters');
  const shelters = useShelters();
  return (
    <div className="stack">
      <h1>Participating shelters</h1>
      <p className="lead">
        Public facility information only. This list never shows who is staying at a shelter, and no search shows registered
        people.
      </p>
      {shelters.isPending && <Loading />}
      {shelters.isError && (
        <p role="alert" className="alert alert-error">
          Could not load the shelter list. {shelters.error.message}
        </p>
      )}
      {shelters.data && (
        <ul className="plain grid">
          {shelters.data.map((s) => (
            <li key={s.id} className="card">
              <h2>{s.name}</h2>
              <dl className="kv">
                <dt>Area</dt>
                <dd>{s.area.label}</dd>
                <dt>Address</dt>
                <dd>{s.publicAddress}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
