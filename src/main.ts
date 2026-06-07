import './ui/styles.css';
import { MOCK_LOCATIONS } from './locations/mock-locations';
import { MOCK_FORECASTS } from './weather/mock-forecasts';
import { renderHomeScreen } from './ui/home-screen';

const app = document.getElementById('app');

if (app === null) {
  // CLAUDE.md › Observability: console at boundaries.
  // eslint-disable-next-line no-console
  console.error('[main] #app root element not found in index.html');
} else {
  app.replaceChildren(renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS));
}
