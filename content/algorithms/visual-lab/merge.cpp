#include <iostream>
void merge(int a[], int buffer[], int lo, int hi) {
    if (lo >= hi) { return; }
    int mid = (lo + hi) / 2;
    merge(a, buffer, lo, mid);
    merge(a, buffer, mid + 1, hi);
    int i = lo; int j = mid + 1; int k = lo;
    while (i <= mid && j <= hi) {
        if (a[i] <= a[j]) { buffer[k] = a[i]; i = i + 1; }
        else { buffer[k] = a[j]; j = j + 1; }
        k = k + 1;
    }
    while (i <= mid) { buffer[k] = a[i]; i = i + 1; k = k + 1; }
    while (j <= hi) { buffer[k] = a[j]; j = j + 1; k = k + 1; }
    for (int t = lo; t <= hi; t = t + 1) { a[t] = buffer[t]; }
}

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    // 开始观察算法
    int buffer[12] = {};
    merge(a, buffer, 0, n - 1);
    for (int i = 0; i < n; i = i + 1) {
        std::cout << a[i] << " ";
    }
    std::cout << "\n";

    return 0;
}
