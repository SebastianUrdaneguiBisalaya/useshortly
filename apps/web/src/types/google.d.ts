/** The slice of Google Identity Services (`https://accounts.google.com/gsi/client`) the app uses. */
interface Window {
  google?: {
    accounts: {
      oauth2: {
        initCodeClient: (config: {
          client_id: string;
          scope: string;
          ux_mode: "popup";
          callback: (response: { code?: string; error?: string }) => void;
        }) => { requestCode: () => void };
      };
    };
  };
}
