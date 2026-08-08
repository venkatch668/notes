import React from 'https://esm.sh/react@18.3.1';
import ReactDOM from 'https://esm.sh/react-dom@18.3.1/client';

const App = () => {
  const [installable, setInstallable] = React.useState(false);
  const [installMessage, setInstallMessage] = React.useState('Install this app on your device for a native-like experience.');
  const installPromptRef = React.useRef(null);

  React.useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      installPromptRef.current = event;
      setInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPromptRef.current) {
      setInstallMessage('Install prompt is not available yet. Open this page from a secure origin or refresh.');
      return;
    }

    installPromptRef.current.prompt();
    const { outcome } = await installPromptRef.current.userChoice;
    setInstallMessage(outcome === 'accepted' ? 'Thanks for installing!' : 'Installation dismissed.');
    setInstallable(false);
    installPromptRef.current = null;
  };

  return React.createElement(
    'main',
    { className: 'app-shell' },
    React.createElement('section', { className: 'hero' },
      React.createElement('h1', null, 'React PWA Sample'),
      React.createElement('p', null, 'A simple progressive web app using React and a service worker.'),
      React.createElement('div', { className: 'controls' },
        installable && React.createElement('button', { onClick: handleInstall }, 'Install App'),
        React.createElement('p', { className: 'hint' }, installMessage)
      )
    ),
    React.createElement('section', { className: 'cards' },
      React.createElement('article', { className: 'card' },
        React.createElement('h2', null, 'Fast load'),
        React.createElement('p', null, 'Cached assets let your app work offline and load quickly on repeat visits.')
      ),
      React.createElement('article', { className: 'card' },
        React.createElement('h2', null, 'Responsive'),
        React.createElement('p', null, 'This demo adapts to phones, tablets, and desktop screens.')
      ),
      React.createElement('article', { className: 'card' },
        React.createElement('h2', null, 'Installable'),
        React.createElement('p', null, 'Use the browser install prompt to add this app to your home screen or desktop.')
      )
    )
  );
};

const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);
root.render(React.createElement(App));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then((registration) => {
        console.log('Service worker registered:', registration.scope);
      })
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });
}
