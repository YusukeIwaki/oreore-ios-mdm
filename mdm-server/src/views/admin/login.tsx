import { page } from "../layout";

/** Admin console login (ported from `views/login.html.erb`). */
export function LoginPage(options: { googleConfigured: boolean; csrfToken: string }) {
  const action = options.googleConfigured ? "/auth/google_oauth2" : "/auth/developer";
  const label = options.googleConfigured ? "Login with Google" : "Login for debug";
  return page(
    <form data-turbo="false" action={action} method="post" class="p-2">
      <input type="hidden" name="authenticity_token" value={options.csrfToken} />
      <button type="submit" class="btn btn-primary">
        {label}
      </button>
    </form>,
  );
}

/** Debug-login email form (replaces OmniAuth developer's request-phase form). */
export function DeveloperLoginPage(options: { csrfToken: string }) {
  return page(
    <form data-turbo="false" action="/auth/developer/callback" method="post" class="p-2">
      <input type="hidden" name="authenticity_token" value={options.csrfToken} />
      <div class="mb-3">
        <label for="input_email" class="form-label">
          Email
        </label>
        <input type="email" class="form-control" id="input_email" name="email" required />
      </div>
      <button type="submit" class="btn btn-primary">
        Login
      </button>
    </form>,
  );
}
