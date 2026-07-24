import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthApp } from "@/components/AuthApp";
import { cloneBoard } from "@/test/boardFixture";

const BOARD_SUMMARIES = [{ id: 1, name: "My Board" }];

const mockResponse = (
  body: unknown,
  status = 200
): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as Response;

describe("AuthApp", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows sign in instead of the board for an anonymous session", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ authenticated: false, username: null })
    );

    render(<AuthApp />);

    expect(screen.getByText("Loading your workspace...")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Kanban Studio" })
    ).not.toBeInTheDocument();
  });

  it("returns to sign in for an unauthorized session response", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ detail: "Session is not valid" }, 401)
    );

    render(<AuthApp />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Kanban Studio" })
    ).not.toBeInTheDocument();
  });

  it("validates that both credentials are present", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ authenticated: false, username: null })
    );
    render(<AuthApp />);
    await screen.findByRole("heading", { name: "Sign in" });

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter your username and password."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows generic feedback for invalid credentials", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ authenticated: false, username: null }))
      .mockResolvedValueOnce(
        mockResponse({ detail: "Invalid username or password" }, 401)
      );
    render(<AuthApp />);
    await screen.findByRole("heading", { name: "Sign in" });

    await userEvent.type(screen.getByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid username or password."
    );
  });

  it("switches to the registration form and creates an account", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ authenticated: false, username: null }))
      .mockResolvedValueOnce(mockResponse({ authenticated: true, username: "newuser" }))
      .mockResolvedValueOnce(mockResponse(BOARD_SUMMARIES))
      .mockResolvedValueOnce(mockResponse(cloneBoard()));
    render(<AuthApp />);
    await screen.findByRole("heading", { name: "Sign in" });

    await userEvent.click(screen.getByRole("tab", { name: "Create account" }));
    expect(
      screen.getByRole("heading", { name: "Create your account" })
    ).toBeVisible();

    await userEvent.type(screen.getByLabelText("Username"), "newuser");
    await userEvent.type(screen.getByLabelText("Password"), "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" })
    ).toBeVisible();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/register",
      expect.objectContaining({
        body: JSON.stringify({ username: "newuser", password: "s3cret" }),
      })
    );
  });

  it("shows feedback for a duplicate username on registration", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ authenticated: false, username: null }))
      .mockResolvedValueOnce(
        mockResponse({ detail: "Username is already taken" }, 409)
      );
    render(<AuthApp />);
    await screen.findByRole("heading", { name: "Sign in" });
    await userEvent.click(screen.getByRole("tab", { name: "Create account" }));

    await userEvent.type(screen.getByLabelText("Username"), "dupe");
    await userEvent.type(screen.getByLabelText("Password"), "password");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already taken"
    );
  });

  it("renders the authenticated board and username", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ authenticated: true, username: "user" })
      )
      .mockResolvedValueOnce(mockResponse(BOARD_SUMMARIES))
      .mockResolvedValueOnce(mockResponse(cloneBoard()));

    render(<AuthApp />);

    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" })
    ).toBeVisible();
    expect(screen.getByText("Signed in as")).toHaveTextContent("user");
    expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
  });

  it("returns to sign in after logout", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ authenticated: true, username: "user" }))
      .mockResolvedValueOnce(mockResponse(BOARD_SUMMARIES))
      .mockResolvedValueOnce(mockResponse(cloneBoard()))
      .mockResolvedValueOnce(
        mockResponse({ authenticated: false, username: null })
      );
    render(<AuthApp />);
    await screen.findByRole("heading", { name: "Kanban Studio" });

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Kanban Studio" })
    ).not.toBeInTheDocument();
  });

  it("returns to sign in when board loading is unauthorized", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ authenticated: true, username: "user" })
      )
      .mockResolvedValueOnce(
        mockResponse({ detail: "Authentication required" }, 401)
      );

    render(<AuthApp />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Kanban Studio" })
    ).not.toBeInTheDocument();
  });

  it("shows a retry option when the session check fails outright", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    render(<AuthApp />);

    expect(
      await screen.findByRole("heading", { name: "Unable to reach the server" })
    ).toBeVisible();

    fetchMock.mockResolvedValueOnce(
      mockResponse({ authenticated: false, username: null })
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
