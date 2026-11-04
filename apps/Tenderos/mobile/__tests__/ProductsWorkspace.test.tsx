import React from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { ProductsWorkspace } from "@/src/components/ProductsWorkspace";

const mockRequestAuthenticated = jest.fn();
jest.mock("@/src/features/auth", () => ({
  useAuth: () => ({ requestAuthenticated: mockRequestAuthenticated }),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: (callback: () => void) =>
    require("react").useEffect(callback, [callback]),
}));

const response = (data: unknown) => ({
  success: true,
  response: { json: async () => ({ data }) },
});

describe("ProductsWorkspace", () => {
  beforeEach(() => {
    mockRequestAuthenticated.mockReset();
    mockPush.mockReset();
  });

  it("loads the selected store's shared and private stock from persisted routes", async () => {
    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: "s1", name: "Market" }, { id: "s2" }]);
      if (path === "/api/v1/tenderos/catalog") return response([]);
      if (path.endsWith("/s1/catalog"))
        return response([
          {
            id: "assignment",
            product: {
              commercialName: "Rice",
              categoryName: "Food",
              brandName: "",
              presentation: "",
              netContent: null,
              netContentUnit: null,
              observedPrices: [],
            },
            price: null,
            stock: 1,
            active: false,
            saleUnit: "kg",
            integerOnly: false,
          },
        ]);
      if (path.endsWith("/s1/products"))
        return response([
          {
            id: "private",
            name: "Local beans",
            categoryName: null,
            price: 2.5,
            stock: 1,
            active: true,
            saleUnit: "kg",
            integerOnly: false,
          },
        ]);
      if (path.endsWith("/s1/product-categories"))
        return response([{ id: "c1", name: "Pantry", shared: true }]);
      return response([]);
    });

    const screen = render(<ProductsWorkspace />);
    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        "/api/v1/tenderos/stores/s1/products",
        undefined,
      ),
    );
    expect(mockRequestAuthenticated).toHaveBeenCalledWith(
      "/api/v1/tenderos/stores/s1/product-categories",
      undefined,
    );
    expect(screen.getByText("Local beans")).toBeTruthy();
    // Copy the redesign changed: the three English labels are Spanish now.
    expect(screen.getByText("Sin precio")).toBeTruthy();
    expect(screen.getByText("Catálogo compartido")).toBeTruthy();
    expect(screen.getByText("Producto propio")).toBeTruthy();
  });

  it("requires valid positive price and sale unit before adding a shared product", async () => {
    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: "s1" }]);
      if (path === "/api/v1/tenderos/catalog")
        return response([
          {
            id: "p1",
            commercialName: "Water",
            categoryName: "Drinks",
            brandName: "",
            presentation: "500 ml",
            netContent: 500,
            netContentUnit: "ml",
            observedPrices: [],
          },
        ]);
      if (path.endsWith("/catalog")) return response([]);
      return response([]);
    });
    const screen = render(<ProductsWorkspace addIntent />);
    await waitFor(() => expect(screen.getByText("Water")).toBeTruthy());
    fireEvent.press(screen.getByText("Water"));
    fireEvent.press(screen.getByText("Agregar a mi tienda"));
    expect(mockRequestAuthenticated).not.toHaveBeenCalledWith(
      expect.stringContaining("/stores/s1/catalog"),
      expect.objectContaining({ method: "POST" }),
    );
    fireEvent.changeText(screen.getByPlaceholderText("Precio (USD)"), "1.25");
    fireEvent.press(screen.getByText("kg"));
    fireEvent.press(screen.getByText("Agregar a mi tienda"));
    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        "/api/v1/tenderos/stores/s1/catalog",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            productId: "p1",
            price: 1.25,
            saleUnit: "kg",
            integerOnly: false,
          }),
        }),
      ),
    );
  });

  it("creates a private product and store-private category using store-scoped endpoints", async () => {
    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: "s1" }]);
      if (path.endsWith("/catalog")) return response([]);
      if (path.endsWith("/products")) return response([]);
      if (path.endsWith("/product-categories")) return response([]);
      return response([]);
    });
    const screen = render(<ProductsWorkspace addIntent />);
    await waitFor(() =>
      expect(screen.getByText("Agregar producto propio")).toBeTruthy(),
    );
    fireEvent.changeText(
      screen.getByPlaceholderText("Nombre del producto"),
      "Farm eggs",
    );
    fireEvent.changeText(screen.getByPlaceholderText("Precio (USD)"), "3.50");
    fireEvent.press(screen.getByText("Crear categoría"));
    fireEvent.changeText(
      screen.getByPlaceholderText("Nombre de la categoría"),
      "Farm",
    );
    fireEvent.press(screen.getByText("Guardar categoría"));
    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        "/api/v1/tenderos/stores/s1/product-categories",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Farm" }),
        }),
      ),
    );
  });

  it("saves a private product through the store-scoped route", async () => {
    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: "s1" }]);
      return response([]);
    });
    const screen = render(<ProductsWorkspace addIntent />);
    await waitFor(() =>
      expect(screen.getByText("Agregar producto propio")).toBeTruthy(),
    );

    fireEvent.changeText(
      screen.getByPlaceholderText("Nombre del producto"),
      "Farm eggs",
    );
    fireEvent.changeText(screen.getByPlaceholderText("Precio (USD)"), "3.50");
    fireEvent.press(screen.getByText("Guardar producto propio"));

    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        "/api/v1/tenderos/stores/s1/products",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "Farm eggs",
            price: 3.5,
            stock: 1,
            saleUnit: "unidad",
            integerOnly: false,
          }),
        }),
      ),
    );
  });

  /**
   * S11 on the biggest screen in the app: the tendero never reads a UUID and
   * never reads a clock time. Both are reachable here — every product row is
   * keyed by a real id and the catalog's observed prices carry an
   * `observedAt` ISO TIMESTAMP that the workspace sorts by — so the fixture
   * carries both and the assertion walks every rendered string.
   *
   * It is a PIN rather than a RED: the screen already renders neither, and
   * this is what makes adding the date to a price line fail here instead of
   * shipping.
   */
  it("renders no identifier and no clock time (S11)", async () => {
    const STORE_ID = "11111111-1111-4111-8111-111111111111";
    const ASSIGNMENT_ID = "22222222-2222-4222-8222-222222222222";
    const PRIVATE_ID = "33333333-3333-4333-8333-333333333333";
    const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";

    mockRequestAuthenticated.mockImplementation(async (path: string) => {
      if (path === "/api/v1/tenderos/stores/me")
        return response([{ id: STORE_ID, name: "Tienda Doña Rosa" }]);
      if (path === "/api/v1/tenderos/catalog") return response([]);
      if (path.endsWith("/catalog"))
        return response([
          {
            id: ASSIGNMENT_ID,
            product: {
              commercialName: "Arroz 1 kg",
              categoryName: "Despensa",
              brandName: "",
              presentation: "",
              netContent: null,
              netContentUnit: null,
              observedPrices: [
                {
                  amount: 1.25,
                  currency: "USD",
                  source: "supermaxi",
                  observedAt: "2026-11-03T14:35:00.000Z",
                },
              ],
            },
            price: 1.5,
            stock: 4,
            active: true,
            saleUnit: "kg",
            integerOnly: false,
          },
        ]);
      if (path.endsWith("/products"))
        return response([
          {
            id: PRIVATE_ID,
            name: "Empanadas de la casa",
            categoryName: null,
            price: 0.8,
            stock: 10,
            active: true,
            saleUnit: "unidad",
            integerOnly: true,
          },
        ]);
      if (path.endsWith("/product-categories"))
        return response([
          { id: CATEGORY_ID, name: "Despensa", shared: true },
        ]);
      return response([]);
    });

    const screen = render(<ProductsWorkspace />);
    await waitFor(() => expect(screen.getByText("Arroz 1 kg")).toBeTruthy());

    const uuid =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const clock = /\d{1,2}:\d{2}/;
    const { Text } = require("react-native");

    for (const node of screen.UNSAFE_getAllByType(Text)) {
      const children = node.props.children;
      for (const child of Array.isArray(children) ? children : [children]) {
        if (typeof child !== "string") continue;
        expect(child).not.toMatch(uuid);
        expect(child).not.toMatch(clock);
      }
    }
  });
});

/**
 * The capabilities the redesign had to keep working. Every one of these is a
 * behaviour the tab already had before T14 and the restyle is only allowed to
 * change how it looks.
 */
describe("the Productos tab keeps every capability it had", () => {
  const STORE_ID = "s1";
  const RICE = "rice-assignment";
  const BEANS = "beans-private";

  const catalogue = () => [
    {
      id: RICE,
      product: {
        id: "rice-catalog",
        categoryId: "cat-1",
        categoryName: "Despensa",
        commercialName: "Arroz 1 kg",
        brandName: "Marca",
        presentation: null,
        netContent: null,
        netContentUnit: null,
        observedPrices: [],
      },
      price: 1.5,
      stock: 4,
      active: true,
      saleUnit: "kg",
      integerOnly: false,
    },
  ];

  const privateRows = () => [
    {
      id: BEANS,
      name: "Frejol de la casa",
      categoryId: null,
      categoryName: "Granos",
      price: 2.5,
      stock: 3,
      active: true,
      saleUnit: "kg",
      integerOnly: false,
    },
  ];

  beforeEach(() => {
    mockRequestAuthenticated.mockReset();
    mockPush.mockReset();
    mockRequestAuthenticated.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (init?.method) return response({ ok: true });
        if (path === "/api/v1/tenderos/stores/me")
          return response([{ id: STORE_ID, name: "Tienda Doña Rosa" }]);
        if (path === "/api/v1/tenderos/catalog") return response([]);
        if (path.endsWith(`/${STORE_ID}/catalog`))
          return response(catalogue());
        if (path.endsWith(`/${STORE_ID}/products`))
          return response(privateRows());
        if (path.endsWith("/product-categories"))
          return response([{ id: "c1", name: "Despensa", shared: true }]);
        return response([]);
      },
    );
  });

  const ready = async () => {
    const screen = render(<ProductsWorkspace />);
    await waitFor(() => expect(screen.getByText("Arroz 1 kg")).toBeTruthy());
    return screen;
  };

  it("still searches the catalog by name", async () => {
    const screen = await ready();

    fireEvent.changeText(screen.getByLabelText("Buscar productos"), "frejol");

    expect(screen.getByText("Frejol de la casa")).toBeTruthy();
    expect(screen.queryByText("Arroz 1 kg")).toBeNull();
  });

  it("still filters the catalog by category", async () => {
    const screen = await ready();

    fireEvent.press(within(screen.getByTestId("category-filters")).getByText("Granos"));

    expect(screen.getByText("Frejol de la casa")).toBeTruthy();
    expect(screen.queryByText("Arroz 1 kg")).toBeNull();

    fireEvent.press(within(screen.getByTestId("category-filters")).getByText("Todas"));
    expect(screen.getByText("Arroz 1 kg")).toBeTruthy();
  });

  it("still edits a product's price and stock through the existing route", async () => {
    const screen = await ready();

    fireEvent.press(screen.getByLabelText("Editar Arroz 1 kg"));
    fireEvent.changeText(screen.getByPlaceholderText("Precio"), "2.00");
    fireEvent.changeText(screen.getByPlaceholderText("Stock"), "9");
    fireEvent.press(screen.getByText("Guardar"));

    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        `/api/v1/tenderos/store-catalog-products/${RICE}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ stock: 9, price: 2 }),
        }),
      ),
    );
  });

  it("still unassigns a product from the store", async () => {
    const screen = await ready();

    fireEvent.press(screen.getByLabelText("Editar Arroz 1 kg"));
    fireEvent.press(screen.getByText("Quitar"));

    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        `/api/v1/tenderos/store-catalog-products/${RICE}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        }),
      ),
    );
  });

  it("still registers a sale against the stored stock", async () => {
    const screen = await ready();

    fireEvent.press(screen.getByText("Registrar venta"));
    fireEvent.press(
      within(screen.getByTestId("sale-products")).getByText("Arroz 1 kg"),
    );
    fireEvent.changeText(screen.getByPlaceholderText("Cantidad"), "2");
    fireEvent.press(screen.getByText("Confirmar venta"));

    await waitFor(() =>
      expect(mockRequestAuthenticated).toHaveBeenCalledWith(
        `/api/v1/tenderos/store-catalog-products/${RICE}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ stock: 2 }),
        }),
      ),
    );
  });

  it("still opens the add tool on intent=add", async () => {
    const screen = render(<ProductsWorkspace addIntent />);

    await waitFor(() =>
      expect(screen.getByText("Elegir del catálogo global")).toBeTruthy(),
    );
  });
});

describe("the Productos tab and the product detail", () => {
  const STORE_ID = "s1";
  const RICE = "rice-assignment";

  beforeEach(() => {
    mockRequestAuthenticated.mockReset();
    mockPush.mockReset();
    mockRequestAuthenticated.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (init?.method) return response({ ok: true });
        if (path === "/api/v1/tenderos/stores/me")
          return response([{ id: STORE_ID, name: "Tienda Doña Rosa" }]);
        if (path === "/api/v1/tenderos/catalog") return response([]);
        if (path.endsWith(`/${STORE_ID}/catalog`))
          return response([
            {
              id: RICE,
              product: {
                id: "rice-catalog",
                categoryId: "cat-1",
                categoryName: "Despensa",
                commercialName: "Arroz 1 kg",
                brandName: "",
                presentation: null,
                netContent: null,
                netContentUnit: null,
                observedPrices: [],
              },
              price: 1.5,
              stock: 4,
              active: true,
              saleUnit: "kg",
              integerOnly: false,
            },
          ]);
        return response([]);
      },
    );
  });

  it("opens the detail of the product whose card was tapped", async () => {
    const screen = render(<ProductsWorkspace />);
    await waitFor(() => expect(screen.getByText("Arroz 1 kg")).toBeTruthy());

    fireEvent.press(screen.getByLabelText("Ver Arroz 1 kg"));

    expect(mockPush).toHaveBeenCalledWith(`/product/${RICE}`);
  });

  it("never navigates when the tendero only wanted to edit", async () => {
    const screen = render(<ProductsWorkspace />);
    await waitFor(() => expect(screen.getByText("Arroz 1 kg")).toBeTruthy());

    fireEvent.press(screen.getByLabelText("Editar Arroz 1 kg"));

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Precio")).toBeTruthy();
  });

  it("opens the editor of the product the detail sent it to", async () => {
    const screen = render(<ProductsWorkspace editProductId={RICE} />);

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Precio")).toBeTruthy(),
    );
  });

  it("ignores an edit intent naming a product that is not in the store", async () => {
    const screen = render(<ProductsWorkspace editProductId="not-here" />);

    await waitFor(() => expect(screen.getByText("Arroz 1 kg")).toBeTruthy());
    expect(screen.queryByPlaceholderText("Precio")).toBeNull();
  });
});
