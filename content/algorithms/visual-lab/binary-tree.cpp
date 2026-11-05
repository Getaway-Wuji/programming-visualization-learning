#include <iostream>
void visit(int a[], int left[], int right[], int node, int order) {
    if (node == -1) { return; }
    if (order == 1) { std::cout << a[node] << " "; }
    visit(a, left, right, left[node], order);
    if (order == 2) { std::cout << a[node] << " "; }
    visit(a, left, right, right[node], order);
    if (order == 3) { std::cout << a[node] << " "; }
}

int main() {
    int n; std::cin >> n;
    int a[12] = {}; int left[12]; int right[12];
    for (int i = 0; i < 12; i = i + 1) { left[i] = -1; right[i] = -1; }
    for (int i = 0; i < n; i = i + 1) { std::cin >> a[i]; }
    int root = -1; int size = 0;
    // 开始观察算法
    if (n > 0) { root = 0; }
    for (int i = 0; i < n; i = i + 1) {
        if (i * 2 + 1 < n) { left[i] = i * 2 + 1; }
        if (i * 2 + 2 < n) { right[i] = i * 2 + 2; }
        size = size + 1;
    }
    visit(a, left, right, root, 1);
    std::cout << "\n";
    return 0;
}
