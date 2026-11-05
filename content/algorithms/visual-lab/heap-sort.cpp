#include <iostream>
void sink(int a[], int size, int root) {
    while (root * 2 + 1 < size) {
        int child = root * 2 + 1;
        if (child + 1 < size && a[child + 1] > a[child]) { child = child + 1; }
        if (a[root] >= a[child]) { break; }
        // 交换开始
        int temp = a[root]; a[root] = a[child]; a[child] = temp;
        // 交换结束

        root = child;
    }
}

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    // 开始观察算法
    for (int i = n / 2 - 1; i >= 0; i = i - 1) { sink(a, n, i); }
    for (int end = n - 1; end > 0; end = end - 1) {
        // 交换开始
        int temp = a[0]; a[0] = a[end]; a[end] = temp;
        // 交换结束

        sink(a, end, 0);
    }
    for (int i = 0; i < n; i = i + 1) {
        std::cout << a[i] << " ";
    }
    std::cout << "\n";

    return 0;
}
