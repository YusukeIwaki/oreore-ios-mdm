import { raw } from "hono/html";
import { page } from "./layout";

/**
 * Enrollment WebView authentication pages
 * (ported from `views/mdm-byod/authenticate.html.erb` and
 * `views/mdm-adde/authenticate.html.erb`).
 */
export interface AuthenticatePageOptions {
  mode: "byod" | "adde";
  userIdentifier?: string;
  email?: string;
  accounts: string[];
  error?: string;
}

export function AuthenticatePage(options: AuthenticatePageOptions) {
  const heading = options.mode === "byod" ? "BYOD authentication" : "User authentication";
  const requestLine =
    options.mode === "byod" ? "Enrollment request from" : "Device enrollment request from";
  const placeholder = options.mode === "byod" ? "Input password!" : "Input PASSWORD!";
  const email = options.email ?? "";

  const body = (
    <>
      <h1>{heading}</h1>
      {options.userIdentifier ? (
        <p>
          {requestLine} {options.userIdentifier}
        </p>
      ) : null}
      {email === "" ? (
        <div class="list-group m-3">
          {options.accounts.map((account) => (
            <a
              href={`?${new URLSearchParams({ email: account }).toString()}`}
              class="list-group-item"
            >
              {account}
            </a>
          ))}
        </div>
      ) : (
        <>
          {options.error ? <div class="alert alert-danger m-3">{options.error}</div> : null}
          <form data-turbo="false" method="post" class="card p-3 m-3">
            <div class="form-group mb-3">
              <label for="inputEmail">Email</label>
              <input
                type="email"
                class="form-control"
                id="inputEmail"
                name="email"
                value={email}
                readonly
              />
            </div>
            <div class="form-group mb-3">
              <label for="inputPassword">Password</label>
              <input
                type="password"
                class="form-control"
                id="inputPassword"
                name="password"
                placeholder={placeholder}
              />
            </div>
            <button type="submit" class="btn btn-primary">
              Login
            </button>
          </form>
          <script type="text/javascript">
            {raw("document.getElementById('inputPassword').focus();")}
          </script>
        </>
      )}
    </>
  );
  return page(body);
}
