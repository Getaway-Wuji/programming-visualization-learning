#include <iostream>
// @phase split
void merge_sort(int values[], int scratch[], int left, int right) {
    if (left >= right) {
        return;
    }
    int mid = left + (right - left) / 2;
    merge_sort(values, scratch, left, mid);
    merge_sort(values, scratch, mid + 1, right);
    // @phase merge
    int i = left;
    int j = mid + 1;
    int at = left;
    while (i <= mid && j <= right) {
        if (values[i] <= values[j]) {
            scratch[at] = values[i];
            i = i + 1;
        } else {
            scratch[at] = values[j];
            j = j + 1;
        }
        at = at + 1;
    }
    // @phase tails
    while (i <= mid) {
        scratch[at] = values[i];
        i = i + 1;
        at = at + 1;
    }
    while (j <= right) {
        scratch[at] = values[j];
        j = j + 1;
        at = at + 1;
    }
    // @phase copy
    for (int k = left; k <= right; k = k + 1) {
        values[k] = scratch[k];
    }
    return;
}
// @phase setup
int main() {
    int n = {{n}};
    int values[30] = {};
    int scratch[30] = {};
    // @phase input
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> values[i];
    }
    // @phase run
    merge_sort(values, scratch, 0, n - 1);
    // @phase output
    for (int i = 0; i < n; i = i + 1) {
        std::cout << values[i] << " ";
    }
    std::cout << "\n";
    return 0;
}
