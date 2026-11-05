#include <iostream>
void quick(int a[], int lo, int hi) {
    if (lo >= hi) { return; }
    int pivot = a[hi];
    int cut = lo;
    for (int j = lo; j < hi; j = j + 1) {
        if (a[j] <= pivot) {
            // 交换开始
            int temp = a[j]; a[j] = a[cut]; a[cut] = temp;
            // 交换结束

            cut = cut + 1;
        }
    }
    // 交换开始
    int temp = a[cut]; a[cut] = a[hi]; a[hi] = temp;
    // 交换结束

    quick(a, lo, cut - 1);
    quick(a, cut + 1, hi);
}

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    // 开始观察算法
    quick(a, 0, n - 1);
    for (int i = 0; i < n; i = i + 1) {
        std::cout << a[i] << " ";
    }
    std::cout << "\n";

    return 0;
}
