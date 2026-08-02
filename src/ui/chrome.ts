const LOGO_SVG = `<svg width="30" height="30" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150.38 88.986" role="img" aria-label="Are.na"><title>Are.na</title><path d="M148.93 62.356l-20.847-16.384c-1.276-1-1.276-2.642 0-3.645l20.848-16.38c1.28-1.002 1.815-2.695 1.19-3.76-.626-1.062-2.374-1.44-3.88-.84l-24.79 9.874c-1.507.606-2.927-.22-3.153-1.83L114.57 2.926C114.34 1.317 113.13 0 111.877 0c-1.247 0-2.456 1.317-2.68 2.925l-3.73 26.467c-.228 1.61-1.646 2.434-3.155 1.83l-24.38-9.71c-1.512-.602-3.975-.602-5.483 0l-24.384 9.71c-1.508.604-2.928-.22-3.154-1.83L41.186 2.925C40.956 1.317 39.748 0 38.5 0c-1.252 0-2.463 1.317-2.688 2.925l-3.73 26.467c-.226 1.61-1.645 2.434-3.153 1.83L4.14 21.35c-1.507-.603-3.252-.223-3.878.838-.625 1.066-.092 2.76 1.184 3.76l20.85 16.38c1.277 1.003 1.277 2.645 0 3.646L1.446 62.356C.166 63.358-.364 65.152.26 66.34c.627 1.19 2.372 1.668 3.877 1.064l24.567-9.866c1.51-.603 2.914.218 3.125 1.828l3.544 26.696c.214 1.607 1.618 2.923 3.12 2.923 1.5 0 2.905-1.315 3.12-2.923l3.55-26.696c.21-1.61 1.62-2.43 3.122-1.828l24.164 9.698c1.506.606 3.97.606 5.477 0l24.16-9.698c1.504-.603 2.91.218 3.125 1.828l3.55 26.696c.212 1.607 1.617 2.923 3.115 2.923 1.502 0 2.907-1.315 3.12-2.923l3.55-26.696c.216-1.61 1.62-2.43 3.124-1.828l24.57 9.866c1.5.604 3.25.125 3.876-1.063.627-1.186.094-2.98-1.185-3.982zM95.89 46.18L77.53 60.315c-1.285.99-3.393.99-4.674 0L54.49 46.18c-1.284-.99-1.294-2.62-.02-3.625l18.4-14.493c1.274-1.005 3.363-1.005 4.638 0l18.4 14.493c1.277 1.004 1.267 2.634-.02 3.626z"></path></svg>`;

export interface ChromeRefs {
  logo: HTMLButtonElement;
  about: HTMLButtonElement;
  login: HTMLButtonElement;
  loginArea: HTMLDivElement;
  promptBackdrop: HTMLDivElement;
  promptWrap: HTMLDivElement;
  promptWelcome: HTMLParagraphElement;
  promptSearchRow: HTMLDivElement;
  promptInputWrap: HTMLDivElement;
  promptInput: HTMLInputElement;
  promptLastBtn: HTMLButtonElement;
  promptRandomBtn: HTMLButtonElement;
  promptFeedback: HTMLDivElement;
}

export function mountChrome(root: HTMLElement): ChromeRefs {
  // Top-left: Are.na logo button
  const logo = document.createElement("button");
  logo.className = "chrome-logo";
  logo.setAttribute("aria-label", "search channels");
  logo.innerHTML = LOGO_SVG;
  root.appendChild(logo);

  // Bottom-left: about button (the one corner not already spoken for —
  // logo top-left, login top-right, are.na link bottom-right)
  const about = document.createElement("button");
  about.type = "button";
  about.className = "chrome-about";
  about.textContent = "about";
  about.setAttribute("aria-label", "about are.na desk");
  root.appendChild(about);

  // Top-right: login area container (houses login button + token input + feedback)
  const loginArea = document.createElement("div");
  loginArea.className = "chrome-login-area";
  root.appendChild(loginArea);

  // Log in button inside the area
  const login = document.createElement("button");
  login.type = "button";
  login.className = "chrome-login";
  login.textContent = "log in";
  loginArea.appendChild(login);

  // Dimming backdrop — shown when searching over an active desk
  const promptBackdrop = document.createElement("div");
  promptBackdrop.className = "chrome-prompt-backdrop";
  promptBackdrop.setAttribute("aria-hidden", "true");
  root.appendChild(promptBackdrop);

  // Center: prompt container
  const promptWrap = document.createElement("div");
  promptWrap.className = "chrome-prompt";

  const promptCenter = document.createElement("div");
  promptCenter.className = "chrome-prompt-center";
  promptWrap.appendChild(promptCenter);

  const promptWelcome = document.createElement("p");
  promptWelcome.className = "chrome-prompt-welcome";
  promptWelcome.textContent = "Welcome to Are.na Desk.";
  promptCenter.appendChild(promptWelcome);

  const promptSearchRow = document.createElement("div");
  promptSearchRow.className = "chrome-prompt-search-row";
  promptCenter.appendChild(promptSearchRow);

  const promptLastBtn = document.createElement("button");
  promptLastBtn.type = "button";
  promptLastBtn.className = "chrome-prompt-side-btn";
  promptLastBtn.textContent = "←";
  promptLastBtn.setAttribute("aria-label", "last channel");
  promptLastBtn.disabled = true;
  promptSearchRow.appendChild(promptLastBtn);

  const promptInputWrap = document.createElement("div");
  promptInputWrap.className = "chrome-prompt-input-wrap";
  promptSearchRow.appendChild(promptInputWrap);

  const promptInput = document.createElement("input");
  promptInput.type = "text";
  promptInput.placeholder = "public channel url or slug";
  promptInput.setAttribute("autocomplete", "off");
  promptInput.setAttribute("spellcheck", "false");
  promptInputWrap.appendChild(promptInput);

  const promptRandomBtn = document.createElement("button");
  promptRandomBtn.type = "button";
  promptRandomBtn.className = "chrome-prompt-side-btn";
  promptRandomBtn.textContent = "*";
  promptRandomBtn.setAttribute("aria-label", "random public channel");
  promptSearchRow.appendChild(promptRandomBtn);

  const promptFeedback = document.createElement("div");
  promptFeedback.className = "chrome-prompt-feedback";
  promptCenter.appendChild(promptFeedback);

  root.appendChild(promptWrap);

  return {
    logo,
    about,
    login,
    loginArea,
    promptBackdrop,
    promptWrap,
    promptWelcome,
    promptSearchRow,
    promptInputWrap,
    promptInput,
    promptLastBtn,
    promptRandomBtn,
    promptFeedback,
  };
}
