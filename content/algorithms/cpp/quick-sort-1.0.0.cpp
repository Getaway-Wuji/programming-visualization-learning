#include <iostream>
// @phase partition
int partition(int values[], int left, int right) {
    int pivotValue = values[right];
    int small = left;
    // @phase scan
    for (int i = left; i < right; i = i + 1) {
        if (values[i] <= pivotValue) {
            if (small != i) {
                int temp = values[small];
                values[small] = values[i];
                values[i] = temp;
            }
            small = small + 1;
        }
    }
    // @phase pivot
    if (small != right) {
        int temp = values[small];
        values[small] = values[right];
        values[right] = temp;
    }
    return small;
}
// @phase recurse
void quick_sort(int values[], int left, int right) {
    while (left < right) {
        int pivotIndex = partition(values, left, right);
        if (pivotIndex - left < right - pivotIndex) {
            if (left < pivotIndex - 1) {
                quick_sort(values, left, pivotIndex - 1);
            }
            left = pivotIndex + 1;
        } else {
            if (pivotIndex + 1 < right) {
                quick_sort(values, pivotIndex + 1, right);
            }
            right = pivotIndex - 1;
        }
    }
    return;
}
// @phase setup
int main() {
    int n = {{n}};
    int values[30] = {};
    // @phase input
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> values[i];
    }
    // @phase run
    quick_sort(values, 0, n - 1);
    // @phase output
    for (int i = 0; i < n; i = i + 1) {
        std::cout << values[i] << " ";
    }
    std::cout << "\n";
    return 0;
}
