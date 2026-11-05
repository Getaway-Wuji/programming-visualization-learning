#include <iostream>
int isRed(int red[], int node) { if (node == -1) { return 0; } return red[node]; }
int rotateLeft(int left[], int right[], int red[], int root) {
    int child = right[root]; right[root] = left[child]; left[child] = root;
    red[child] = red[root]; red[root] = 1; return child;
}
int rotateRight(int left[], int right[], int red[], int root) {
    int child = left[root]; left[root] = right[child]; right[child] = root;
    red[child] = red[root]; red[root] = 1; return child;
}
int insert(int a[], int left[], int right[], int red[], int root, int node) {
    if (root == -1) { red[node] = 1; return node; }
    if (a[node] < a[root]) { left[root] = insert(a, left, right, red, left[root], node); }
    else { right[root] = insert(a, left, right, red, right[root], node); }
    if (isRed(red, right[root]) == 1 && isRed(red, left[root]) == 0) { root = rotateLeft(left, right, red, root); }
    if (isRed(red, left[root]) == 1 && isRed(red, left[left[root]]) == 1) { root = rotateRight(left, right, red, root); }
    if (isRed(red, left[root]) == 1 && isRed(red, right[root]) == 1) {
        red[root] = 1 - red[root]; red[left[root]] = 0; red[right[root]] = 0;
    }
    return root;
}
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
    int red[12] = {};
    // 开始观察算法
    for (int i = 0; i < n; i = i + 1) {
        root = insert(a, left, right, red, root, i); red[root] = 0; size = size + 1;
    }
    visit(a, left, right, root, 2); std::cout << "\n";
    return 0;
}
